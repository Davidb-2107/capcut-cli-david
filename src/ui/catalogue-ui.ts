// Regénère la cartographie visuelle du catalogue : un HTML autonome mirroiré
// dans <vault>/cartographie/capcut-cli-catalogue.html (à côté de
// capcut-cli-capabilities.html, même charte). Best-effort par construction :
// appelée depuis writeCatalogueAtomic, une panne ici ne doit JAMAIS compromettre
// l'écriture du JSON.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS, stripBom } from "../commands/query.js";
import { findVaultRoot } from "../utils/vault.js";

export interface CatalogueDoc {
  type?: string;
  entries: {
    id: string;
    kinds: string[];
    names: string[];
    resource_id: string | null;
    effect_id: string | null;
    font_paths: string[];
    first_seen: string;
    witness_drafts: string[];
    note: string;
    ignored: boolean;
    merged_from: string[];
    classification: string;
  }[];
}

/**
 * Résout le template. dist/ui/catalogue-template.html est copié par build-ui.mjs
 * au build — sans lui (source checkout non buildé), on rend null et l'appelant
 * skip silencieusement.
 */
function template(): string | null {
  const p = join(dirname(fileURLToPath(import.meta.url)), "catalogue-template.html");
  if (!existsSync(p)) return null;
  const t = readFileSync(p, "utf-8");
  return t.includes("/*__DATA__*/") ? t : null;
}

export const CATALOGUE_MIRROR_NAME = "capcut-cli-catalogue.html";

/**
 * Rend le HTML autonome (ou null si le template est introuvable). `source` est
 * affiché en pied de page pour traçabilité du miroir.
 */
export function renderCatalogueHtml(doc: CatalogueDoc, source: string): string | null {
  const t = template();
  if (!t) return null;
  const data = {
    builtAt: new Date().toISOString().slice(0, 10),
    source,
    kindOrder: KINDS,
    entries: [...doc.entries].sort((a, b) => ((a.names[0] ?? "") < (b.names[0] ?? "") ? -1 : 1)),
  };
  // </script> dans une string JSON casserait le parseur HTML — échapper.
  const json = JSON.stringify(data).replace(/<\//g, "<\\/");
  return t.replace("/*__DATA__*/", `const DATA = ${json};`);
}

/**
 * Point unique appelé après chaque écriture du catalogue (sync, --add). Si le
 * catalogue vit dans un vault et que cartographie/ existe, on y (ré)écrit le
 * miroir ; sinon no-op. Retourne le chemin écrit ou null.
 */
export function regenerateCatalogueMirror(cataloguePath: string): string | null {
  let doc: CatalogueDoc;
  try {
    doc = JSON.parse(stripBom(readFileSync(cataloguePath, "utf-8"))) as CatalogueDoc;
  } catch {
    return null; // catalogue corrompu/inaccessible : l'appelant fait déjà le rapport
  }
  const html = renderCatalogueHtml(doc, cataloguePath);
  if (!html) return null;
  const vault = findVaultRoot(dirname(cataloguePath));
  if (!vault) return null;
  const mirror = join(vault, "cartographie", CATALOGUE_MIRROR_NAME);
  if (!existsSync(join(vault, "cartographie"))) return null;
  writeFileSync(mirror, html);
  return mirror;
}
