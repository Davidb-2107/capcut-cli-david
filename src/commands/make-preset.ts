// Generate a bare-font `restyle` preset for a font found in the CapCut drafts
// library. The generation cousin of `query`: scans every draft under the
// projects root (or --drafts), finds a font by NAME (case-insensitive substring,
// or exact resource_id if the arg is numeric), and emits a ready-to-use preset
// carrying ONLY the font identity (no stroke/shadow/size). Never writes a draft.
// Spec: docs/superpowers/specs/2026-06-07-make-preset-design.md
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";

// --- defensive narrowing (drafts are untrusted JSON) — mirrored from query.ts
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

export interface FontCandidate {
  resource_id: string | null;
  title: string;
  font_path: string | null;
  source_platform: number;
  /** The raw fonts[] entry from the draft — emitted verbatim for fidelity. */
  fonts_entry: Record<string, unknown>;
  from_drafts: string[];
}

export type PlanResult =
  | { status: "match"; font: FontCandidate }
  | { status: "none" }
  | { status: "ambiguous"; candidates: FontCandidate[] };

type RawFont = Omit<FontCandidate, "from_drafts">;

// Extract every titled font block from ONE draft.
function extractFonts(draft: unknown): RawFont[] {
  const fonts: RawFont[] = [];
  const d = rec(draft);
  const m = d ? rec(d.materials) : null;
  if (!m) return fonts;
  for (const t of arr(m.texts)) {
    for (const f of arr(t.fonts)) {
      const title = str(f.title);
      if (!title) continue;
      const sp = typeof f.source_platform === "number" ? f.source_platform : typeof t.font_source_platform === "number" ? t.font_source_platform : 0;
      fonts.push({
        resource_id: str(f.resource_id),
        title,
        font_path: str(f.path) ?? str(t.font_path),
        source_platform: sp,
        fonts_entry: f,
      });
    }
  }
  return fonts;
}

// Dedupe key: catalogue fonts by resource_id; local fonts by title+path.
function dedupeKey(f: RawFont): string {
  return f.resource_id ? `rid:${f.resource_id}` : `local:${f.title}|${f.font_path ?? ""}`;
}

// Is this entry "catalogue-grade" (a real downloaded font, preferred on tie)?
function catalogueGrade(f: RawFont): boolean {
  return !!f.resource_id && f.source_platform === 1 && !!f.font_path && f.font_path.includes(`/effect/${f.resource_id}/`);
}

// Pure: extract → dedupe (prefer catalogue-grade) → match → classify.
export function planMakePreset(drafts: Array<{ name: string; draft: unknown }>, font: string): PlanResult {
  const index = new Map<string, FontCandidate>();
  for (const { name, draft } of drafts) {
    for (const raw of extractFonts(draft)) {
      const key = dedupeKey(raw);
      const existing = index.get(key);
      if (!existing) {
        index.set(key, { ...raw, from_drafts: [name] });
      } else {
        if (!existing.from_drafts.includes(name)) existing.from_drafts.push(name);
        // Upgrade to a catalogue-grade representative if a better one appears.
        if (!catalogueGrade(existing) && catalogueGrade(raw)) {
          index.set(key, { ...raw, from_drafts: existing.from_drafts });
        }
      }
    }
  }

  const isNumeric = /^\d+$/.test(font);
  const needle = font.toLowerCase();
  let matches = [...index.values()].filter((c) =>
    isNumeric ? c.resource_id === font : c.title.toLowerCase().includes(needle),
  );
  for (const c of matches) c.from_drafts.sort();
  matches.sort((a, b) => a.title.localeCompare(b.title));

  // Distinct by dedupe key (a single font matched in many drafts is one match).
  const distinct = new Map<string, FontCandidate>();
  for (const c of matches) distinct.set(c.resource_id ? `rid:${c.resource_id}` : `local:${c.title}|${c.font_path ?? ""}`, c);

  // Title-level dedup: if a catalogue-grade and local entry share the same title,
  // the catalogue-grade entry wins (local is a fallback, not a distinct font).
  const byTitle = new Map<string, FontCandidate>();
  for (const c of distinct.values()) {
    const tk = c.title.toLowerCase();
    const existing = byTitle.get(tk);
    if (!existing || (!catalogueGrade(existing) && catalogueGrade(c))) {
      byTitle.set(tk, c);
    }
  }
  const list = [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));

  if (list.length === 0) return { status: "none" };
  if (list.length > 1) return { status: "ambiguous", candidates: list };
  return { status: "match", font: list[0] };
}

// Build a BARE-FONT restyle preset from a chosen font. Copies the draft's real
// fonts[] entry verbatim (fidelity), normalizing its path to font_path and
// clearing request_id (CapCut wipes non-empty engine-written request_ids).
// Emits ONLY font fields — restyleMaterial grafts every text_material key, so
// any extra key (shadow/border/name) would leak onto every caption.
export function buildPreset(font: FontCandidate): Record<string, unknown> {
  const path = font.font_path ?? "";
  const fontsEntry = { ...font.fonts_entry, path, request_id: "" };
  return {
    text_material: {
      font_title: font.title,
      font_resource_id: font.resource_id ?? "",
      font_source_platform: font.source_platform,
      font_path: path,
      fonts: [fontsEntry],
    },
    content_template: {
      text: "",
      styles: [{ font: { path, id: font.resource_id ?? "" } }],
    },
    segment: {},
  };
}

// Returns the process exit code (0 success incl. zero/ambiguous; 2 operational).
// Usage errors (missing --font) throw via die() → exit 1 in the top-level catch.
export function cmdMakePreset(flags: Flags): number {
  const font = flags.font;
  if (!font) die("Missing --font <name|resource_id>. Usage: capcut-david make-preset --font <name|rid> [--out <file>] [--drafts <dir>]");

  const root = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
    return 2;
  }

  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (!existsSync(file)) continue;
    try {
      const draft = JSON.parse(readFileSync(file, "utf8"));
      if (rec(draft)) drafts.push({ name: entry.name, draft });
    } catch {
      // skip unreadable/malformed, keep scanning
    }
  }

  const plan = planMakePreset(drafts, font);

  if (plan.status === "none") {
    out({ type: "capcut-david/make-preset@1", ok: true, font: null, ambiguous: false, candidates: [], written: null, preset: null }, flags);
    return 0;
  }
  if (plan.status === "ambiguous") {
    out(
      {
        type: "capcut-david/make-preset@1",
        ok: true,
        font: null,
        ambiguous: true,
        candidates: plan.candidates.map((c) => ({ title: c.title, resource_id: c.resource_id, from_drafts: c.from_drafts })),
        written: null,
        preset: null,
      },
      flags,
    );
    return 0;
  }

  const f = plan.font;
  if (!f.resource_id) {
    process.stderr.write(`${JSON.stringify({ error: `Font '${f.title}' is a local font (no resource_id); cannot build a catalogue preset. Apply a catalogue font in CapCut instead.` })}\n`);
    return 2;
  }

  const preset = buildPreset(f);
  let written: string | null = null;
  if (flags.out) {
    writeFileSync(flags.out, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
    written = flags.out;
  }
  out(
    {
      type: "capcut-david/make-preset@1",
      ok: true,
      font: { title: f.title, resource_id: f.resource_id, font_path: f.font_path, source_platform: f.source_platform, from_drafts: f.from_drafts },
      ambiguous: false,
      candidates: [],
      written,
      preset,
    },
    flags,
  );
  return 0;
}
