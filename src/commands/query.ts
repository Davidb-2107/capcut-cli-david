// Read-only catalogue lookup across the CapCut drafts library. Finds effects,
// filters, transitions and fonts by NAME (case-insensitive substring) and
// returns their resource_id — so a draft builder can inject the right resource
// without guessing the long numeric id. Scans every draft under the projects
// root (or --drafts), dedupes, and reports which drafts each item came from.
// Never writes. See QUERY-kickoff.md for the frozen spec.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";

export type QueryKind = "effect" | "filter" | "transition" | "font";
const KINDS: QueryKind[] = ["effect", "filter", "transition", "font"];

export interface QueryResultItem {
  kind: QueryKind;
  name: string;
  resource_id: string | null;
  effect_id: string | null;
  category_name: string | null;
  font_path: string | null; // fonts only; null for non-fonts
  from_drafts: string[]; // sorted, unique draft folder basenames
}

type RawItem = Omit<QueryResultItem, "from_drafts">;

// --- defensive narrowing (drafts are untrusted JSON) ------------------------
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

// Closed set of trailing weight/variant tokens deriveFontName may strip.
const WEIGHT_TOKENS = new Set([
  "thin",
  "extralight",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
  "italic",
  "bolditalic",
  "variablefont",
  "wght",
]);

// Derive a human font name from a .ttf/.otf path. Strips the extension and ONE
// trailing weight token (plus the VariableFont+wght pair). Never strips
// arbitrary tokens (would corrupt e.g. "PlayfairDisplay"/"CC-DerStil").
export function deriveFontName(fontPath: string): string {
  const base = fontPath.split(/[/\\]/).pop() ?? fontPath;
  const stripped = base.replace(/\.(ttf|otf|ttc)$/i, "");
  const parts = stripped.split(/[-_]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase();
    if (WEIGHT_TOKENS.has(last)) {
      parts.pop();
      // B7: VariableFont + wght → strip the VariableFont too, then stop.
      if (last === "wght" && parts.length > 1 && parts[parts.length - 1].toLowerCase() === "variablefont") {
        parts.pop();
      }
      const out = parts.join("-");
      if (out) return out;
    }
  }
  return stripped;
}

// Extract every catalogue item from ONE draft (from_drafts filled by caller).
function extractItems(draft: unknown): RawItem[] {
  const items: RawItem[] = [];
  const d = rec(draft);
  const m = d ? rec(d.materials) : null;
  if (!m) return items;

  // effects + filters share materials.effects, partitioned by type.
  for (const e of arr(m.effects)) {
    const name = str(e.name);
    if (!name) continue;
    const kind: QueryKind = e.type === "filter" ? "filter" : "effect";
    items.push({ kind, name, resource_id: str(e.resource_id), effect_id: str(e.effect_id), category_name: str(e.category_name), font_path: null });
  }
  // video_effects are all effects.
  for (const e of arr(m.video_effects)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({ kind: "effect", name, resource_id: str(e.resource_id), effect_id: str(e.effect_id), category_name: str(e.category_name), font_path: null });
  }
  // transitions
  for (const e of arr(m.transitions)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({ kind: "transition", name, resource_id: str(e.resource_id), effect_id: str(e.effect_id), category_name: str(e.category_name), font_path: null });
  }
  // fonts: primary = texts[].fonts[].title; fallback = texts[].font_path (local).
  for (const t of arr(m.texts)) {
    const fonts = arr(t.fonts);
    if (fonts.length > 0) {
      for (const f of fonts) {
        const name = str(f.title);
        if (!name) continue;
        items.push({ kind: "font", name, resource_id: str(f.resource_id), effect_id: str(f.effect_id), category_name: str(f.category_name), font_path: str(f.path) ?? str(t.font_path) });
      }
    } else {
      const fp = str(t.font_path);
      if (fp) items.push({ kind: "font", name: deriveFontName(fp), resource_id: str(t.font_resource_id), effect_id: null, category_name: null, font_path: fp });
    }
  }
  return items;
}

function dedupeKey(it: RawItem): string {
  if (it.kind === "font" && !it.resource_id) return `font|${it.name}|${it.font_path ?? ""}`;
  // resource_id is the dedupe key when present; fall back to name when absent.
  return `${it.kind}|${it.resource_id ?? `name:${it.name}`}`;
}

// Pure: extract → dedupe across drafts → substring match → optional kind filter
// → stable sort. `kind` is pre-validated by the caller.
export function planQuery(drafts: Array<{ name: string; draft: unknown }>, term: string, kind?: string): QueryResultItem[] {
  const index = new Map<string, QueryResultItem>();
  for (const { name, draft } of drafts) {
    for (const raw of extractItems(draft)) {
      const key = dedupeKey(raw);
      let item = index.get(key);
      if (!item) {
        item = { ...raw, from_drafts: [] };
        index.set(key, item);
      }
      if (!item.from_drafts.includes(name)) item.from_drafts.push(name);
    }
  }
  const needle = term.toLowerCase();
  let results = [...index.values()].filter((it) => it.name.toLowerCase().includes(needle));
  if (kind) results = results.filter((it) => it.kind === kind);
  for (const it of results) it.from_drafts.sort();
  results.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
  return results;
}

function renderHuman(results: QueryResultItem[], flags: Flags): void {
  if (flags.quiet) return;
  if (results.length === 0) {
    console.log("No matches.");
    return;
  }
  const rows = results.map((r) => ({
    kind: r.kind,
    name: r.name,
    rid: r.resource_id ?? "(none)",
    from: r.from_drafts.join(", ") + (r.kind === "font" && !r.resource_id && r.font_path ? `   ${r.font_path}` : ""),
  }));
  const wKind = Math.max(4, ...rows.map((r) => r.kind.length));
  const wName = Math.max(4, ...rows.map((r) => r.name.length));
  const wRid = Math.max(11, ...rows.map((r) => r.rid.length));
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("KIND", wKind)}  ${pad("NAME", wName)}  ${pad("RESOURCE_ID", wRid)}  FROM_DRAFTS`);
  for (const r of rows) {
    console.log(`${pad(r.kind, wKind)}  ${pad(r.name, wName)}  ${pad(r.rid, wRid)}  ${r.from}`);
  }
}

// Returns the process exit code (0 success incl. zero matches; 2 operational).
// Usage / invalid-flag errors throw via die() → exit 1 in the top-level catch.
export function cmdQuery(positional: string[], flags: Flags): number {
  const term = positional[1];
  if (!term) die("Missing search term. Usage: capcut-david query <term> [--kind effect|filter|transition|font] [--drafts <dir>]");
  if (flags.kind && !KINDS.includes(flags.kind as QueryKind)) {
    die(`Invalid --kind '${flags.kind}'. Expected one of: effect, filter, transition, font.`);
  }

  const root = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
    return 2;
  }

  const draftFolders: Array<{ name: string; file: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (existsSync(file)) draftFolders.push({ name: entry.name, file });
  }
  if (draftFolders.length === 0) {
    out({ type: "capcut-david/query@1", results: [] }, flags);
    return 0;
  }

  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const { name, file } of draftFolders) {
    let draft: unknown;
    try {
      draft = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // skip unreadable/malformed, keep scanning
    }
    if (!rec(draft)) continue;
    drafts.push({ name, draft });
  }
  if (drafts.length === 0) {
    process.stderr.write(`${JSON.stringify({ error: "No readable drafts found (all draft_content.json failed to parse)." })}\n`);
    return 2;
  }

  const results = planQuery(drafts, term, flags.kind);
  if (flags.human) {
    renderHuman(results, flags);
    return 0;
  }
  out({ type: "capcut-david/query@1", results }, flags);
  return 0;
}
