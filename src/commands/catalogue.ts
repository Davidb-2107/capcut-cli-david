// Persistent, append-only record of every CapCut resource seen in the drafts
// library. Where `query` is stateless (delete a draft, lose the resource_id),
// this file remembers forever and carries the human's hand-written notes.
// Frozen design: docs/superpowers/specs/2026-08-07-catalogue-design.md
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { isCapCutRunning } from "../utils/capcut-guard.js";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { resolveCataloguePath } from "../utils/vault.js";
import { extractItems, type RawItem, stripBom } from "./query.js";

// Durable identity. NEVER the display name for a resolved entry: CapCut names
// are localized (the same resource_id comes back as "Fade Out" or "渐隐"
// depending on which client wrote the draft), so a name key is a coin flip.
// `kind` is excluded too — it is a routing artifact, not a property of the
// resource: cutcli writes a filter to materials.video_effects (kind "effect"),
// CapCut UI writes it to materials.effects (kind "filter").
export function catalogueId(it: RawItem): string {
  if (it.resource_id) return it.resource_id;
  if (it.effect_id) return it.effect_id;
  if (it.kind === "font" && it.font_path) return `local:${normalizePath(it.font_path)}`;
  return `unresolved:${it.kind}|${nfc(it.name)}`;
}

// Backslashes → slashes and case folded: the same font file must not yield two
// keys because one draft spelled the path differently.
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}

export interface CatalogueEntry {
  id: string;
  kinds: string[];
  names: string[];
  resource_id: string | null;
  effect_id: string | null;
  font_paths: string[];
  first_seen: string; // YYYY-MM-DD, UTC
  witness_drafts: string[];
  note: string;
  ignored: boolean;
  merged_from: string[];
}

export interface ScannedItem {
  item: RawItem;
  draft: string;
}

// Codepoint order. Never localeCompare: its result depends on the host locale
// and the ICU build, so the same catalogue would reorder between this machine
// and CI, destroying the empty-diff guarantee.
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedSet = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodepoint);

function blank(id: string, today: string): CatalogueEntry {
  return {
    id,
    kinds: [],
    names: [],
    resource_id: null,
    effect_id: null,
    font_paths: [],
    first_seen: today,
    witness_drafts: [],
    note: "",
    ignored: false,
    merged_from: [],
  };
}

// Merge one sighting into an entry. Only ever widens: note, ignored and
// first_seen are untouchable here.
function absorb(e: CatalogueEntry, s: ScannedItem): void {
  const it = s.item;
  e.kinds = sortedSet([...e.kinds, it.kind]);
  e.names = sortedSet([...e.names, nfc(it.name)]);
  e.witness_drafts = sortedSet([...e.witness_drafts, s.draft]);
  if (it.font_path) e.font_paths = sortedSet([...e.font_paths, normalizePath(it.font_path)]);
  if (!e.resource_id && it.resource_id) e.resource_id = it.resource_id;
  if (!e.effect_id && it.effect_id) e.effect_id = it.effect_id;
}

/**
 * Append-only merge. Pure: no I/O, no clock — `today` is injected.
 *
 * Invariants, each one guarding a reproduced failure:
 *  - nothing is ever removed, even when every witness draft is gone;
 *  - `note` / `ignored` / `merged_from` belong to the human and are copied through;
 *  - `ignored` entries are inert: never re-fed, never renamed, never re-added;
 *  - a `local:` font entry that later shows up with a resource_id is PROMOTED
 *    into the id-bearing entry (note and oldest first_seen follow) instead of
 *    spawning a second entry that would orphan the note.
 */
export function planCatalogueMerge(
  existing: CatalogueEntry[],
  scanned: ScannedItem[],
  today: string,
): { entries: CatalogueEntry[]; added: string[]; promoted: string[] } {
  // witness_drafts is a projection of current reality ("which drafts contain
  // this resource right now"), not history — so it is rebuilt from scratch
  // from this scan on every merge. Reset it here for every non-ignored entry;
  // do not "restore" a stale witness later, that would undo this on purpose.
  // Ignored entries are inert and keep whatever they had.
  const index = new Map<string, CatalogueEntry>();
  for (const e of existing)
    index.set(e.id, {
      ...e,
      kinds: [...e.kinds],
      names: [...e.names],
      font_paths: [...e.font_paths],
      witness_drafts: e.ignored ? [...e.witness_drafts] : [],
      merged_from: [...e.merged_from],
    });

  const added: string[] = [];
  const promoted: string[] = [];

  for (const s of scanned) {
    const id = catalogueId(s.item);
    let e = index.get(id);
    if (e?.ignored) continue;
    if (!e) {
      e = blank(id, today);
      index.set(id, e);
      added.push(id);
    }
    absorb(e, s);

    // Promotion: this sighting carries a resource_id, so fold in any local:
    // entry for the same font. Path match first (the file IS the identity),
    // name match as the fallback for a re-downloaded font at a new path.
    if (s.item.resource_id && s.item.kind === "font") {
      const path = s.item.font_path ? normalizePath(s.item.font_path) : null;
      const name = nfc(s.item.name);
      for (const [otherId, other] of index) {
        if (otherId === id || !otherId.startsWith("local:") || other.ignored) continue;
        const samePath = path !== null && (otherId === `local:${path}` || other.font_paths.includes(path));
        const sameName = other.names.includes(name);
        if (!samePath && !sameName) continue;
        e.kinds = sortedSet([...e.kinds, ...other.kinds]);
        e.names = sortedSet([...e.names, ...other.names]);
        e.font_paths = sortedSet([...e.font_paths, ...other.font_paths]);
        e.witness_drafts = sortedSet([...e.witness_drafts, ...other.witness_drafts]);
        if (!e.effect_id && other.effect_id) e.effect_id = other.effect_id;
        if (byCodepoint(other.first_seen, e.first_seen) < 0) e.first_seen = other.first_seen;
        // Never drop a human note: if both sides carry one, keep both. The loser's
        // entry is about to be deleted from the index, so a silent choice here is
        // unrecoverable data loss.
        if (other.note) e.note = e.note ? `${e.note}\n---\n${other.note}` : other.note;
        e.merged_from = sortedSet([...e.merged_from, ...other.merged_from, otherId]);
        index.delete(otherId);
        promoted.push(otherId);
        const at = added.indexOf(otherId);
        if (at !== -1) added.splice(at, 1);
      }
    }
  }

  const entries = [...index.values()].sort((a, b) => byCodepoint(a.id, b.id));
  return { entries, added: sortedSet(added), promoted: sortedSet(promoted) };
}

const ENVELOPE = "capcut-david/catalogue@1";

// A malformed existing catalogue is an OPERATIONAL failure (exit 2), not a usage
// error (exit 1): the file exists and we refuse to touch it. Distinct from
// CliError so the command layer can map it to the right code.
export class CatalogueFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CatalogueFormatError";
  }
}

/**
 * Parse an existing catalogue. THROWS on anything it does not recognize.
 *
 * This is the most important rule in the feature: a truncated write or a bad
 * hand-edit must stop the run, not silently reset the file. `note` is the only
 * datum here that nobody can regenerate.
 */
export function parseCatalogue(text: string): CatalogueEntry[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  if (clean === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch (e) {
    throw new CatalogueFormatError(
      `catalogue illisible (JSON invalide) : ${(e as Error).message}. Aucune écriture effectuée.`,
    );
  }
  const rec = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!rec)
    throw new CatalogueFormatError(
      "catalogue illisible : racine JSON inattendue (objet attendu). Aucune écriture effectuée.",
    );
  if (rec.type !== ENVELOPE)
    throw new CatalogueFormatError(`catalogue illisible : type "${String(rec.type)}" (attendu "${ENVELOPE}").`);
  if (!Array.isArray(rec.entries))
    throw new CatalogueFormatError("catalogue illisible : champ `entries` absent ou non-tableau.");
  const entries = rec.entries.map((raw, i) => normalizeEntry(raw, i));
  // Two entries with the same id: the merge index would keep only the last one
  // and destroy the first one's note. That is exactly what a "keep both" git
  // conflict resolution produces, so refuse instead of silently deduplicating.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id))
      throw new CatalogueFormatError(
        `catalogue illisible : id dupliqué "${e.id}". Fusionne les deux entrées à la main.`,
      );
    seen.add(e.id);
  }
  return entries;
}

function normalizeEntry(raw: unknown, i: number): CatalogueEntry {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || r.id === "")
    throw new CatalogueFormatError(`catalogue illisible : entrée #${i} sans \`id\`.`);
  // Absent → default. Present but wrong-typed → refuse: coercing it would write
  // the repaired value back and lose whatever the human actually meant.
  const bad = (f: string): CatalogueFormatError =>
    new CatalogueFormatError(
      `catalogue illisible : entrée #${i} (${r.id as string}), champ \`${f}\` de type inattendu.`,
    );
  const strArr = (v: unknown, f: string): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw bad(f);
    return v as string[];
  };
  const strOrNull = (v: unknown, f: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") throw bad(f);
    return v === "" ? null : v;
  };
  const str = (v: unknown, f: string): string => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") throw bad(f);
    return v;
  };
  return {
    id: r.id as string,
    kinds: strArr(r.kinds, "kinds"),
    names: strArr(r.names, "names"),
    resource_id: strOrNull(r.resource_id, "resource_id"),
    effect_id: strOrNull(r.effect_id, "effect_id"),
    font_paths: strArr(r.font_paths, "font_paths"),
    first_seen: str(r.first_seen, "first_seen"),
    witness_drafts: strArr(r.witness_drafts, "witness_drafts"),
    note: str(r.note, "note"),
    ignored: r.ignored === true,
    merged_from: strArr(r.merged_from, "merged_from"),
  };
}

// The sort lives here, not only in planCatalogueMerge: the empty-diff guarantee
// must not depend on every future caller remembering to route through the merge.
export function serializeCatalogue(entries: CatalogueEntry[]): string {
  const sorted = [...entries].sort((a, b) => byCodepoint(a.id, b.id));
  return `${JSON.stringify({ type: ENVELOPE, entries: sorted }, null, 2)}\n`;
}

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
}

const KINDS = new Set(["effect", "filter", "transition", "font"]);

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

// Returns the process exit code. 0 success (incl. nothing new), 2 operational.
export function cmdCatalogue(flags: Flags): number {
  if (flags.kind !== undefined && !KINDS.has(flags.kind)) {
    die(`Invalid --kind '${flags.kind}'. Expected one of: effect, filter, transition, font.`);
  }
  const cataloguePath = resolveCataloguePath(flags.catalogue, process.cwd());

  let entries: CatalogueEntry[] = [];
  if (existsSync(cataloguePath)) {
    try {
      entries = parseCatalogue(readFileSync(cataloguePath, "utf-8"));
    } catch (e) {
      // Échec OPÉRATIONNEL, pas d'usage : le fichier existe, on refuse d'y toucher.
      if (!(e instanceof CatalogueFormatError)) throw e;
      process.stderr.write(`${JSON.stringify({ error: e.message })}\n`);
      return 2;
    }
  }

  let added: string[] = [];
  let promoted: string[] = [];

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
      console.log(`${added.length} ajoutée(s), ${promoted.length} promue(s)${flags.dryRun ? " — dry-run, rien écrit" : ""}`);
    }
    renderCatalogueHuman(shown, flags);
    return 0;
  }
  out({ type: ENVELOPE, path: cataloguePath, dry_run: flags.dryRun === true, added, promoted, entries: shown }, flags);
  return 0;
}

// UTC, pas l'heure locale : champ reproductible en test et identique sur toutes
// les machines. Coût : un sync à 00h30 CET est daté de la veille.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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
    note: e.ignored ? "(ignorée)" : e.note,
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
