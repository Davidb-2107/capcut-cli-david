// I/O + CLI shell for catalogue.ts's pure merge/parse/serialize logic:
// atomic disk writes, drafts-library scanning, flag parsing, human rendering.
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { regenerateCatalogueMirror } from "../ui/catalogue-ui.js";
import { isCapCutRunning } from "../utils/capcut-guard.js";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { resolveCataloguePath } from "../utils/vault.js";
import { extractItems, KINDS, KINDS_LIST, KINDS_SPACED, stripBom } from "./query.js";
import {
  blank,
  type CatalogueEntry,
  ENVELOPE,
  nfc,
  parseCatalogue,
  planCatalogueMerge,
  type ScannedItem,
  serializeCatalogue,
  sortedSet,
  todayUtc,
} from "./catalogue.js";

/**
 * Same-directory tmp + rename: the rename is atomic on one volume, so a crash
 * mid-write can never leave a truncated catalogue. On Windows the rename can
 * lose to Obsidian or a sync client holding the file — retry once, then fail
 * loudly. Never degrade to a direct (truncating) write.
 */
export function writeCatalogueAtomic(path: string, text: string): void {
  // pid-suffixed: two concurrent runs must not write into the same tmp file.
  const tmpPath = `${path}.${process.pid}.tmp`;
  const scrub = () => {
    try {
      unlinkSync(tmpPath);
    } catch {}
  };
  writeFileSync(tmpPath, text, "utf-8");
  try {
    renameSync(tmpPath, path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") {
      scrub();
      throw e;
    }
    try {
      renameSync(tmpPath, path);
    } catch {
      scrub();
      die(`catalogue verrouillé (${code}) : ${path}. Ferme Obsidian ou ton client de synchro et relance.`);
    }
  }
  // Le JSON est posé : la cartographie HTML se régénère, best-effort — sa
  // fraîcheur ne doit jamais pouvoir faire échouer le verbe d'écriture.
  try {
    regenerateCatalogueMirror(path);
  } catch {}
}

// Ensemble dérivé de la SEULE liste de kinds (query.ts) — jamais de copie locale.
const KIND_SET = new Set<string>(KINDS);

function scanDrafts(root: string): { scanned: ScannedItem[]; draftCount: number } {
  const scanned: ScannedItem[] = [];
  let draftCount = 0;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const file = join(root, dirent.name, "draft_content.json");
    if (!existsSync(file)) continue;
    let draft: unknown;
    try {
      draft = JSON.parse(stripBom(readFileSync(file, "utf8")));
    } catch {
      continue; // draft illisible : on saute, le scan continue
    }
    draftCount++;
    for (const item of extractItems(draft)) scanned.push({ item, draft: dirent.name });
  }
  return { scanned, draftCount };
}

function renderCatalogueHuman(entries: CatalogueEntry[], flags: Flags): void {
  if (flags.quiet) return;
  if (entries.length === 0) {
    console.log("Catalogue vide.");
    return;
  }
  const rows = entries.map((e) => ({
    kinds: e.kinds.join(","),
    name: e.names.join(" / "),
    id: e.id,
    seen: e.first_seen,
    // La promotion fabrique des notes multi-lignes ("<a>\n---\n<b>") : telles
    // quelles, elles disloquent la table.
    note: e.ignored ? "(ignorée)" : e.note.replace(/\n/g, " ⏎ "),
  }));
  const w = (key: keyof (typeof rows)[0], min: number) => Math.max(min, ...rows.map((r) => r[key].length));
  const wk = w("kinds", 5);
  const wn = w("name", 4);
  const wi = w("id", 2);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("KINDS", wk)}  ${pad("NAME", wn)}  ${pad("ID", wi)}  FIRST_SEEN  NOTE`);
  for (const r of rows) {
    console.log(`${pad(r.kinds, wk)}  ${pad(r.name, wn)}  ${pad(r.id, wi)}  ${r.seen}  ${r.note}`);
  }
}

// Returns the process exit code. 0 success (incl. nothing new), 2 operational.
export function cmdCatalogue(flags: Flags): number {
  if (flags.kind !== undefined && !KIND_SET.has(flags.kind)) {
    die(`Invalid --kind '${flags.kind}'. Expected one of: ${KINDS_LIST}.`);
  }
  const cataloguePath = resolveCataloguePath(flags.catalogue, process.cwd());

  const readEntries = (): CatalogueEntry[] =>
    existsSync(cataloguePath) ? parseCatalogue(readFileSync(cataloguePath, "utf-8")) : [];

  let entries: CatalogueEntry[] = [];
  try {
    entries = readEntries();
  } catch (e) {
    // Échec OPÉRATIONNEL, pas d'usage : le fichier existe, on refuse d'y toucher.
    // Vaut aussi pour un EACCES / EISDIR : un fichier présent mais illisible est
    // exactement le cas où un script appelant a besoin du 2 documenté.
    process.stderr.write(`${JSON.stringify({ error: (e as Error).message })}\n`);
    return 2;
  }

  let added: string[] = [];
  let promoted: string[] = [];

  // Entrer une ressource dont on connaît l'id mais dont le draft témoin n'existe
  // plus — rien à moissonner, donc `--sync` ne peut rien pour elle. Volontairement
  // HORS de planCatalogueMerge : celui-ci remet à zéro les witness_drafts de
  // toutes les entrées non ignorées, ce qui effacerait les témoins de tout le
  // catalogue au passage. Ici on ne touche que l'entrée visée.
  if (flags.add !== undefined) {
    if (flags.sync) die("--add et --sync sont exclusifs : --add n'a rien à moissonner.");
    if (!flags.kind) die(`--add exige --kind (${KINDS_SPACED}).`);
    if (!flags.name) die("--add exige --name (le nom affiché par CapCut).");
    const id = flags.add;
    if (id === "") die("--add exige un resource_id non vide.");
    let e = entries.find((x) => x.id === id);
    if (!e) {
      e = blank(id, todayUtc());
      entries = [...entries, e];
      added = [id];
    }
    e.kinds = sortedSet([...e.kinds, flags.kind]);
    e.names = sortedSet([...e.names, nfc(flags.name)]);
    if (!e.resource_id && !id.startsWith("local:") && !id.startsWith("unresolved:")) e.resource_id = id;
    // Jamais choisir entre deux notes humaines — même règle que la promotion.
    if (flags.note) e.note = e.note ? `${e.note}\n---\n${flags.note}` : flags.note;
    if (!flags.dryRun) {
      try {
        writeCatalogueAtomic(cataloguePath, serializeCatalogue(entries));
      } catch (err) {
        process.stderr.write(`${JSON.stringify({ error: (err as Error).message })}\n`);
        return 2;
      }
    }
  }

  if (flags.sync) {
    const root = flags.drafts ?? defaultProjectsRoot();
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
      return 2;
    }
    // Le repo vit SOUS le vault : la marche par ancre depuis `node --test`
    // résout le vrai catalogue. Les fixtures ne doivent jamais l'atteindre.
    if (`${root}${sep}`.includes(`${sep}test-fixtures${sep}`)) {
      process.stderr.write(`${JSON.stringify({ error: "Refusing to sync from a test-fixtures/ drafts root." })}\n`);
      return 2;
    }
    // Le garde ci-dessus protège la SOURCE ; celui-ci la CIBLE. Un test qui
    // pointe --drafts sur un mkdtemp mais oublie --catalogue écrirait des
    // fixtures dans le vrai catalogue de l'utilisateur, sans qu'aucun garde
    // ne se déclenche — la seule combinaison qui n'a aucun usage légitime.
    // realpath des DEUX côtés : sur macOS, mkdtemp rend /var/... et tmpdir()
    // /private/var/... (lien symbolique). Comparer les chemins bruts laissait le
    // garde muet là-bas — exactement la plateforme où on ne le testait pas à la main.
    if (flags.catalogue === undefined && `${realpathSync(root)}${sep}`.startsWith(`${realpathSync(tmpdir())}${sep}`)) {
      process.stderr.write(
        `${JSON.stringify({ error: "Refusing to sync a temp drafts root into the default catalogue (pass --catalogue)." })}\n`,
      );
      return 2;
    }
    const { scanned, draftCount } = scanDrafts(root);
    if (draftCount === 0) {
      process.stderr.write(`${JSON.stringify({ error: `No readable drafts found under: ${root}` })}\n`);
      return 2;
    }
    // CapCut garde le draft en mémoire et ne le vide qu'à la sauvegarde/fermeture :
    // un sync lancé juste après avoir appliqué un effet ne capture rien, et
    // l'utilisateur conclurait que le catalogue est complet.
    if (!flags.quiet && isCapCutRunning()) {
      process.stderr.write("[warn] CapCut est ouvert : sauvegarde le draft avant de synchroniser.\n");
    }
    const plan = planCatalogueMerge(entries, scanned, todayUtc());
    entries = plan.entries;
    added = plan.added;
    promoted = plan.promoted;
    if (!flags.dryRun) {
      try {
        // Relecture + refusion juste avant le rename (spec §6). Le scan dure des
        // secondes sur une vraie bibliothèque : une note tapée dans Obsidian
        // pendant ce temps serait écrasée par le rename. planCatalogueMerge est
        // pur et idempotent, donc rejouable tel quel. Il reste la fenêtre entre
        // cette relecture et le rename — des microsecondes, pas des secondes.
        const fresh = planCatalogueMerge(readEntries(), scanned, todayUtc());
        entries = fresh.entries;
        added = fresh.added;
        promoted = fresh.promoted;
        writeCatalogueAtomic(cataloguePath, serializeCatalogue(entries));
      } catch (e) {
        // Fichier verrouillé, disque plein, droits : opérationnel (2), pas usage (1).
        process.stderr.write(`${JSON.stringify({ error: (e as Error).message })}\n`);
        return 2;
      }
    }
  }

  const shown = flags.kind ? entries.filter((e) => e.kinds.includes(flags.kind as string)) : entries;
  if (flags.human) {
    // Sans ça, `catalogue --sync -H` (l'exemple documenté) ne dit rien de ce
    // qu'il vient de capturer : la table seule ne distingue pas un sync vide.
    if (flags.sync && !flags.quiet) {
      console.log(
        `${added.length} ajoutée(s), ${promoted.length} promue(s)${flags.dryRun ? " — dry-run, rien écrit" : ""}`,
      );
    }
    renderCatalogueHuman(shown, flags);
    return 0;
  }
  out({ type: ENVELOPE, path: cataloguePath, dry_run: flags.dryRun === true, added, promoted, entries: shown }, flags);
  return 0;
}
