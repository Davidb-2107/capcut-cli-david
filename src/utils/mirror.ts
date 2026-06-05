// Font-mirroring sidecar pass — ports fix_content_styles_font.py (force
// content.styles[].font everywhere it lives) + fix_key_value.py (dropdown
// registry) + restyle.py's template-2.tmp/.bak mirror. All targets are
// skip-if-absent; key_value.json is never fabricated (parity with the Python
// preflight that requires it to pre-exist).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTimelineDirs } from "./timelines.js";

export interface FontMirror {
  /** Absolute path to the .ttf, as written into font_path + content.styles[].font.path. */
  path: string;
  /** content.styles[].font.id — CapCut stores the resource_id here. */
  id: string;
  /** key_value.json registry key. */
  resourceId: string;
}

/**
 * Reproduce the registry entry CapCut writes into key_value.json when the user
 * picks a font via the dropdown (port of fix_key_value.py:font_entry). Keyed by
 * the font's resource_id at the call site.
 */
export function buildKeyValueEntry(
  resourceId: string,
  subcategory = "Presets",
  searchKeyword = "",
): Record<string, unknown> {
  return {
    Tiktok_music_is_avaliable: false,
    add_to_timeline_before_download: false,
    commerce_template_cate: "",
    commerce_template_pay_status: "",
    commerce_template_pay_type: "",
    enter_from: "",
    filter_category: "",
    filter_detail: "",
    is_brand: 0,
    is_favorite: false,
    is_from_artist_shop: 0,
    is_limited: false,
    is_similar_music: false,
    is_vip: "0",
    keywordSource: "normal_search",
    materialCategory: "font",
    materialId: resourceId,
    materialName: "",
    materialSubcategory: subcategory,
    materialSubcategoryId: "",
    materialThirdcategory: "",
    materialThirdcategoryId: "",
    material_copyright: "",
    material_is_purchased: "",
    music_source: "",
    original_song_id: "",
    original_song_name: "",
    pgc_id: "",
    pgc_name: "",
    previewed: 0,
    previewed_before_added: 0,
    rank: "0",
    rec_id: "",
    requestId: "",
    right_block_type: "",
    right_count_type: "",
    right_is_trial: "",
    right_oneoff_mix_type: "",
    right_trial_limit_left: "",
    right_trial_mode: "",
    right_trial_type: "",
    role: "",
    searchId: "",
    searchKeyword,
    special_effect_loading_type: "",
    team_id: "",
    template_author_id: "",
    template_drafts_price: 0,
    template_duration: 0,
    template_fragment_cnt: 0,
    template_need_purcahse: true,
    template_pay_type: "",
    template_type: "",
    template_use_cnt: 0,
    textTemplateVersion: "",
  };
}

/** Force every content.styles[].font.{path,id} in one parsed content string. Returns the new string or null if unchanged/unparseable. */
function patchContentString(contentStr: string, font: FontMirror): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(contentStr);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const styles = (obj as { styles?: unknown }).styles;
  if (!Array.isArray(styles)) return null;
  let changed = false;
  for (const st of styles) {
    const f = st && typeof st === "object" ? (st as { font?: unknown }).font : null;
    if (f && typeof f === "object") {
      const fontObj = f as { path?: unknown; id?: unknown };
      if (fontObj.path !== font.path) {
        fontObj.path = font.path;
        changed = true;
      }
      if (fontObj.id !== font.id) {
        fontObj.id = font.id;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(obj) : null;
}

/** Recursively find embedded `content` JSON strings carrying a font reference and patch them in place. */
function walkPatch(obj: unknown, font: FontMirror): boolean {
  let changed = false;
  if (Array.isArray(obj)) {
    for (const v of obj) changed = walkPatch(v, font) || changed;
  } else if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const c = rec.content;
    if (typeof c === "string" && c.includes('"font"') && c.includes("path")) {
      const patched = patchContentString(c, font);
      if (patched !== null) {
        rec.content = patched;
        changed = true;
      }
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "content") continue;
      changed = walkPatch(v, font) || changed;
    }
  }
  return changed;
}

/**
 * Mirror the new font across all the files CapCut reads besides the primary
 * draft_content.json (which the caller already saved). `draft` is the full new
 * draft object; `kvEntry` is the key_value registry entry (omit to skip that step).
 */
export function mirrorFont(
  draftDir: string,
  draft: unknown,
  font: FontMirror,
  kvEntry?: Record<string, unknown>,
): { written: string[] } {
  const written: string[] = [];
  const newJson = JSON.stringify(draft);

  // Runtime mirrors of the primary draft — Python writes the NEW content here.
  for (const sib of ["template-2.tmp", "draft_content.json.bak"]) {
    writeFileSync(join(draftDir, sib), newJson, "utf-8");
    written.push(sib);
  }

  // Timeline journal mirrors — force the embedded content fonts (skip-if-absent).
  for (const { guid: uuid, dir: tldir } of listTimelineDirs(draftDir)) {
    const targets = [
      "draft_content.json",
      "draft_content.json.bak",
      "template-2.tmp",
      join("attachment", "patch", "mini_draft.json"),
      join("attachment", "patch", "patch.json"),
    ];
    for (const rel of targets) {
      const p = join(tldir, rel);
      if (!existsSync(p)) continue;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        continue;
      }
      if (walkPatch(data, font)) {
        writeFileSync(p, JSON.stringify(data), "utf-8");
        written.push(`Timelines/${uuid}/${rel.replace(/\\/g, "/")}`);
      }
    }
  }

  // Dropdown registry — inject only if the file already exists (never fabricate).
  const kvPath = join(draftDir, "key_value.json");
  if (kvEntry && existsSync(kvPath)) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(kvPath, "utf-8"));
    } catch {
      data = null;
    }
    if (data && typeof data === "object") {
      (data as Record<string, unknown>)[font.resourceId] = kvEntry;
      writeFileSync(kvPath, JSON.stringify(data), "utf-8");
      written.push("key_value.json");
    }
  }

  return { written };
}
