import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CatalogueEntry, parseCatalogue } from "../commands/catalogue.js";
import { defaultProjectsRoot } from "./capcut-paths.js";
import { resolveCataloguePath } from "./vault.js";

export interface ResolvedFont {
  title: string;
  resourceId: string | null;
  fontPath: string;
  source: "catalogue" | "draft";
}

export interface FontCandidate {
  resource_id: string | null;
  title: string;
  font_path: string | null;
  source_platform: number;
  /** The raw fonts[] entry from the draft — emitted verbatim for fidelity. */
  fonts_entry: Record<string, unknown>;
  from_drafts: string[];
}

export type FontPlanResult =
  | { status: "match"; font: FontCandidate }
  | { status: "none" }
  | { status: "ambiguous"; candidates: FontCandidate[] };

type RawFont = Omit<FontCandidate, "from_drafts">;

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function arr(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function extractFonts(draft: unknown): RawFont[] {
  const fonts: RawFont[] = [];
  const d = rec(draft);
  const m = d ? rec(d.materials) : null;
  if (!m) return fonts;
  for (const t of arr(m.texts)) {
    for (const f of arr(t.fonts)) {
      const title = str(f.title);
      if (!title) continue;
      const sourcePlatform =
        typeof f.source_platform === "number"
          ? f.source_platform
          : typeof t.font_source_platform === "number"
            ? t.font_source_platform
            : 0;
      fonts.push({
        resource_id: str(f.resource_id),
        title,
        font_path: str(f.path) ?? str(t.font_path),
        source_platform: sourcePlatform,
        fonts_entry: f,
      });
    }
  }
  return fonts;
}

function dedupeKey(font: RawFont): string {
  return font.resource_id ? `rid:${font.resource_id}` : `local:${font.title}|${font.font_path ?? ""}`;
}

function normalizeFontPath(path: string | null): string | null {
  return path ? path.replace(/\\/g, "/").toLowerCase() : null;
}

function pathCarriesResourceId(path: string | null, resourceId: string | null): boolean {
  const normalized = normalizeFontPath(path);
  return !!normalized && !!resourceId && normalized.includes(`/effect/${resourceId.toLowerCase()}/`);
}

function catalogueGrade(font: RawFont): boolean {
  return (
    !!font.resource_id &&
    font.source_platform === 1 &&
    !!font.font_path &&
    font.font_path.replace(/\\/g, "/").includes(`/effect/${font.resource_id}/`)
  );
}

function sameFontIdentity(a: RawFont, b: RawFont): boolean {
  if (a.resource_id && b.resource_id) return a.resource_id === b.resource_id;

  const aPath = normalizeFontPath(a.font_path);
  const bPath = normalizeFontPath(b.font_path);
  if (aPath && bPath) return aPath === bPath;

  return pathCarriesResourceId(a.font_path, b.resource_id) || pathCarriesResourceId(b.font_path, a.resource_id);
}

/**
 * Pure draft matching shared by make-preset and the filesystem-backed resolver.
 * Numeric references are exact resource IDs; all other references are
 * case-insensitive title substrings.
 */
export function planFontCandidates(drafts: Array<{ name: string; draft: unknown }>, reference: string): FontPlanResult {
  const index = new Map<string, FontCandidate>();
  for (const { name, draft } of drafts) {
    for (const raw of extractFonts(draft)) {
      const key = dedupeKey(raw);
      const existing = index.get(key);
      if (!existing) {
        index.set(key, { ...raw, from_drafts: [name] });
        continue;
      }
      if (!existing.from_drafts.includes(name)) existing.from_drafts.push(name);
      if (!catalogueGrade(existing) && catalogueGrade(raw)) {
        index.set(key, { ...raw, from_drafts: existing.from_drafts });
      }
    }
  }

  const numeric = /^\d+$/.test(reference);
  const needle = reference.toLowerCase();
  const matches = [...index.values()].filter((candidate) =>
    numeric ? candidate.resource_id === reference : candidate.title.toLowerCase().includes(needle),
  );
  for (const candidate of matches) candidate.from_drafts.sort();
  matches.sort((a, b) => a.title.localeCompare(b.title));

  // Same-title witnesses are only collapsed when they point to the same font
  // identity. Distinct resource IDs or distinct local files must stay ambiguous.
  const list: FontCandidate[] = [];
  for (const candidate of matches) {
    const existing = list.find(
      (current) =>
        current.title.toLowerCase() === candidate.title.toLowerCase() && sameFontIdentity(current, candidate),
    );
    if (!existing) {
      list.push(candidate);
      continue;
    }
    if (!existing.from_drafts.includes(candidate.from_drafts[0] ?? "")) {
      existing.from_drafts = [...new Set([...existing.from_drafts, ...candidate.from_drafts])].sort();
    }
    if (!catalogueGrade(existing) && catalogueGrade(candidate)) {
      const replacement = { ...candidate, from_drafts: existing.from_drafts };
      list[list.indexOf(existing)] = replacement;
    }
  }
  list.sort((a, b) => a.title.localeCompare(b.title));

  if (list.length === 0) return { status: "none" };
  if (list.length > 1) return { status: "ambiguous", candidates: list };
  return { status: "match", font: list[0] };
}

function catalogueMatches(entries: CatalogueEntry[], reference: string): CatalogueEntry[] {
  const numeric = /^\d+$/.test(reference);
  const needle = reference.toLowerCase();
  return entries.filter((entry) => {
    if (!entry.kinds.includes("font")) return false;
    if (numeric) return entry.resource_id === reference || entry.id === reference;
    return entry.names.some((name) => name.toLowerCase().includes(needle));
  });
}

function isReadableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function formatReference(reference: string): string {
  return reference === "" ? "<empty>" : `"${reference}"`;
}

function ambiguous(reference: string, candidates: Array<{ title: string; resourceId: string | null }>): never {
  const detail = candidates
    .map((candidate) => `${candidate.title} (${candidate.resourceId ?? "no resource_id"})`)
    .join(", ");
  throw new Error(`Font reference ${formatReference(reference)} is ambiguous: ${detail}.`);
}

function resolveCatalogueFont(entries: CatalogueEntry[], reference: string): ResolvedFont | null {
  const matches = catalogueMatches(entries, reference);
  if (matches.length === 0) return null;

  const usable = matches.flatMap((entry) => {
    const path = entry.font_paths.find(isReadableFile);
    return path ? [{ entry, path }] : [];
  });
  if (usable.length === 0) {
    const details = matches
      .map((entry) => `${entry.names.join(" / ") || entry.id}: ${entry.font_paths.join(", ") || "no font_paths"}`)
      .join("; ");
    throw new Error(
      `Font reference ${formatReference(reference)} matched the catalogue, but no font file is readable: ${details}.`,
    );
  }
  if (usable.length > 1) {
    ambiguous(
      reference,
      usable.map(({ entry }) => ({ title: entry.names[0] ?? entry.id, resourceId: entry.resource_id })),
    );
  }

  const { entry, path } = usable[0];
  return {
    title: entry.names[0] ?? reference,
    resourceId: entry.resource_id ?? (/^\d+$/.test(entry.id) ? entry.id : null),
    fontPath: path,
    source: "catalogue",
  };
}

function loadDrafts(root: string): Array<{ name: string; draft: unknown }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Drafts root not found while resolving font: ${root}`);
  }
  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, "utf8").replace(/^﻿/, "");
      const draft = JSON.parse(text) as unknown;
      if (rec(draft)) drafts.push({ name: entry.name, draft });
    } catch {
      // Draft libraries are user data; one malformed draft must not hide the others.
    }
  }
  return drafts;
}

/** Resolve a font from the persistent catalogue first, then current drafts. */
export function resolveFontReference(
  reference: string,
  options: { draftsRoot?: string; cwd?: string } = {},
): ResolvedFont {
  if (typeof reference !== "string" || reference.length === 0) {
    throw new Error("A non-empty font name or resource_id is required.");
  }

  const cwd = options.cwd ?? process.cwd();
  const cataloguePath = resolveCataloguePath(undefined, cwd);
  if (existsSync(cataloguePath) && statSync(cataloguePath).isFile()) {
    let entries: CatalogueEntry[];
    try {
      entries = parseCatalogue(readFileSync(cataloguePath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read font catalogue ${cataloguePath}: ${(error as Error).message}`);
    }
    const catalogueFont = resolveCatalogueFont(entries, reference);
    if (catalogueFont) return catalogueFont;
  }

  const root = options.draftsRoot ?? defaultProjectsRoot();
  const drafts = loadDrafts(root);
  const plan = planFontCandidates(drafts, reference);
  if (plan.status === "none") {
    throw new Error(`Font reference ${formatReference(reference)} was not found in the catalogue or drafts.`);
  }
  if (plan.status === "ambiguous") {
    ambiguous(
      reference,
      plan.candidates.map((candidate) => ({ title: candidate.title, resourceId: candidate.resource_id })),
    );
  }

  const candidate = plan.font;
  if (!candidate.font_path || !isReadableFile(candidate.font_path)) {
    throw new Error(
      `Font reference ${formatReference(reference)} resolved to '${candidate.title}', but its font file is not readable: ${candidate.font_path ?? "<missing path>"}.`,
    );
  }
  return {
    title: candidate.title,
    resourceId: candidate.resource_id,
    fontPath: candidate.font_path,
    source: "draft",
  };
}
