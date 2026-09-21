// Read-only catalogue lookup across the CapCut drafts library. Finds effects,
// filters, transitions, fonts, stickers, masks, animations and keyframe curves
// by NAME (case-insensitive substring) and returns their resource_id — so a
// draft builder can inject the right resource without guessing the long numeric
// id. Scans every draft under the projects root (or --drafts), dedupes, and
// reports which drafts each item came from. Never writes.
export type QueryKind = "effect" | "filter" | "transition" | "font" | "sticker" | "mask" | "animation" | "curve";
// Seule liste de kinds du CLI — catalogue.ts la consomme aussi (new Set(KINDS)),
// et chaque message d'aide/erreur se dérive des constantes ci-dessous. Ne jamais
// ré-écrire la liste en dur ailleurs (elle a vécu en 10 copies, 4 orthographes).
export const KINDS: QueryKind[] = ["effect", "filter", "transition", "font", "sticker", "mask", "animation", "curve"];
export const KINDS_PIPE = KINDS.join("|"); // signatures d'usage : a|b|c
export const KINDS_LIST = KINDS.join(", "); // messages d'erreur : a, b, c
export const KINDS_SPACED = KINDS.join(" | "); // invite --add : a | b | c

export interface QueryResultItem {
  kind: QueryKind;
  name: string;
  resource_id: string | null;
  effect_id: string | null;
  category_name: string | null;
  font_path: string | null; // fonts only; null for non-fonts
  from_drafts: string[]; // sorted, unique draft folder basenames
}

export type RawItem = Omit<QueryResultItem, "from_drafts">;

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

// PowerShell-written drafts carry a UTF-8 BOM; a bare JSON.parse throws on it
// and the caller's catch would silently drop the whole draft. draft.ts strips
// it on the load path — the scan path must too.
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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
export function extractItems(draft: unknown): RawItem[] {
  const items: RawItem[] = [];
  const d = rec(draft);

  // curves: keyframe_graph_list is a ROOT-level array, NOT under materials —
  // it must be read before the early return below (a draft with curves and no
  // materials block would otherwise lose them). Keyframes reference a graph by
  // graphID → keyframe_graph_list[].id (a LOCAL uuid, never the catalogue id);
  // the catalogue id is resource_id, and the name lives in resource_name (the
  // only family where the display name is not `name`).
  for (const g of arr(d?.keyframe_graph_list)) {
    const name = str(g.resource_name);
    if (!name) continue;
    items.push({
      kind: "curve",
      name,
      resource_id: str(g.resource_id),
      effect_id: null,
      category_name: null,
      font_path: null,
    });
  }

  const m = d ? rec(d.materials) : null;
  if (!m) return items;

  // effects + filters share materials.effects, partitioned by type.
  for (const e of arr(m.effects)) {
    const name = str(e.name);
    if (!name) continue;
    const kind: QueryKind = e.type === "filter" ? "filter" : "effect";
    items.push({
      kind,
      name,
      resource_id: str(e.resource_id),
      effect_id: str(e.effect_id),
      category_name: str(e.category_name),
      font_path: null,
    });
  }
  // video_effects are all effects.
  for (const e of arr(m.video_effects)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({
      kind: "effect",
      name,
      resource_id: str(e.resource_id),
      effect_id: str(e.effect_id),
      category_name: str(e.category_name),
      font_path: null,
    });
  }
  // transitions
  for (const e of arr(m.transitions)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({
      kind: "transition",
      name,
      resource_id: str(e.resource_id),
      effect_id: str(e.effect_id),
      category_name: str(e.category_name),
      font_path: null,
    });
  }
  // stickers — flat, same shape as transitions.
  for (const e of arr(m.stickers)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({
      kind: "sticker",
      name,
      resource_id: str(e.resource_id),
      effect_id: str(e.effect_id),
      category_name: str(e.category_name),
      font_path: null,
    });
  }
  // masks — materials.common_mask (SINGULAR: materials.masks does not exist).
  // category_name is present but "" on the real drafts seen so far.
  for (const e of arr(m.common_mask)) {
    const name = str(e.name);
    if (!name) continue;
    items.push({
      kind: "mask",
      name,
      resource_id: str(e.resource_id),
      effect_id: str(e.effect_id),
      category_name: str(e.category_name),
      font_path: null,
    });
  }
  // animations — doubly nested under materials: a flat wrapper
  // ({id, type:"sticker_animation", animations[]}) linked to its segment via
  // extra_material_refs[]; the resource_id/name live in the INNER array, so
  // reading the wrapper alone yields nothing. Skip entries with an empty id:
  // that is an EMPTY SLOT, and its resource_id carries a different identifier
  // than the actual animation (the animation's own id sits in
  // third_resource_id there) — dedupeKey would key on the wrong value.
  for (const w of arr(m.material_animations)) {
    for (const a of arr(w.animations)) {
      if (!str(a.id)) continue;
      const name = str(a.name);
      if (!name) continue;
      items.push({
        kind: "animation",
        name,
        resource_id: str(a.resource_id),
        effect_id: str(a.effect_id),
        category_name: str(a.category_name),
        font_path: null,
      });
    }
  }
  // fonts: primary = texts[].fonts[].title; fallback = texts[].font_path (local).
  for (const t of arr(m.texts)) {
    const fonts = arr(t.fonts);
    if (fonts.length > 0) {
      for (const f of fonts) {
        const name = str(f.title);
        if (!name) continue;
        items.push({
          kind: "font",
          name,
          resource_id: str(f.resource_id),
          effect_id: str(f.effect_id),
          category_name: str(f.category_name),
          font_path: str(f.path) ?? str(t.font_path),
        });
      }
    } else {
      const fp = str(t.font_path);
      if (fp)
        items.push({
          kind: "font",
          name: deriveFontName(fp),
          resource_id: str(t.font_resource_id),
          effect_id: null,
          category_name: null,
          font_path: fp,
        });
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
export function planQuery(
  drafts: Array<{ name: string; draft: unknown }>,
  term: string,
  kind?: string,
): QueryResultItem[] {
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
