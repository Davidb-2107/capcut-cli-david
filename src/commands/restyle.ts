// Caption font-mirroring restyle — ports the CapCut-CaptionStyling Python
// patchers (restyle.py + fix_fonts_full + fix_content_styles_font + fix_key_value)
// into the engine. Applies a font/stroke/shadow preset to every caption,
// span-aware so multi-span keyword captions keep their per-span colors + ranges.

import { existsSync, readFileSync } from "node:fs";
import { type Draft, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";

/** A per-span style block (font/strokes/shadows/size/bold…) grafted onto each span. */
export type SpanStyle = Record<string, unknown>;

/** Caption style preset (same schema as preset_captions_style.json). */
export interface CaptionStylePreset {
  text_material: Record<string, unknown>;
  content_template: { text?: string; styles: Array<Record<string, unknown>> };
  segment: Record<string, unknown>;
}

/**
 * Restyle a caption's `content` JSON: graft `spanStyle` onto every existing span
 * while preserving each span's `range` and `fill` (the keyword colors). Inverse
 * of clone-style (which preserves font, varies color).
 */
export function restyleContent(contentStr: string, spanStyle: SpanStyle): string {
  const parsed = JSON.parse(contentStr) as { text: string; styles?: Array<Record<string, unknown>> };
  const span0 = parsed.styles ?? [];
  // A lone span covers the whole text → CapCut wants a CODE-UNIT range. The engine's
  // legacy single-span path stores a UTF-16 BYTE-length range, so re-derive it here;
  // multi-span keyword ranges are already code units and are preserved verbatim.
  const single = span0.length === 1;
  const styles = span0.map((span) => ({
    // Preserve the keyword color (fill) + range; graft the preset look on top.
    // Key order mirrors CapCut's content_template span: fill, <style…>, range.
    fill: span.fill,
    ...(JSON.parse(JSON.stringify(spanStyle)) as Record<string, unknown>),
    range: single ? [0, parsed.text.length] : span.range,
  }));
  return JSON.stringify({ ...parsed, styles });
}

/**
 * Graft the preset's material-level fields (font_path, font_resource_id, fonts[],
 * has_shadow, shadow_x, border_x, is_rich_text…) onto a caption material and rebuild
 * its content span-aware. Pure: returns a new material, input untouched.
 * - clears `recognize_task_id` (else CapCut Auto-Captions regenerate + wipe the style)
 * - re-asserts `base_content`/`recognize_text` to the caption text AFTER grafting,
 *   so the preset's empty values don't blank the source text (latent restyle.py bug)
 */
export function restyleMaterial(
  mat: Record<string, unknown>,
  materialFields: Record<string, unknown>,
  spanStyle: SpanStyle,
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(mat)) as Record<string, unknown>;
  const text = (() => {
    try {
      return (JSON.parse(String(next.content)) as { text?: string }).text ?? "";
    } catch {
      return "";
    }
  })();
  const hadRecognizeText = "recognize_text" in next;
  for (const [k, v] of Object.entries(materialFields)) {
    next[k] = JSON.parse(JSON.stringify(v));
  }
  next.recognize_task_id = "";
  next.base_content = text;
  if (hadRecognizeText) next.recognize_text = text;
  next.is_rich_text = true;
  if (typeof next.content === "string") next.content = restyleContent(next.content, spanStyle);
  return next;
}

/** The per-span graft block = the preset's first content_template span minus its own fill + range. */
export function spanStyleFromPreset(preset: CaptionStylePreset): SpanStyle {
  const first = preset.content_template?.styles?.[0] ?? {};
  const { fill: _fill, range: _range, ...rest } = first as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest)) as SpanStyle;
}

export interface ApplyCaptionStyleOptions {
  preset: CaptionStylePreset;
  /** Restrict to one named text track; default = ALL text tracks (apply to every caption). */
  trackName?: string;
}

/**
 * Apply a caption style preset to every caption on the target text track(s).
 * Scopes to materials REACHABLE from those tracks' segments (B-8) so orphaned
 * text materials left by import-captions are never touched.
 */
export function applyCaptionStyle(
  draft: Draft,
  filePath: string,
  opts: ApplyCaptionStyleOptions,
): { materialsPatched: number; segmentsPatched: number } {
  const spanStyle = spanStyleFromPreset(opts.preset);
  const materialFields = opts.preset.text_material ?? {};
  const segmentFields = opts.preset.segment ?? {};

  const tracks = draft.tracks.filter(
    (t) => t.type === "text" && (opts.trackName === undefined || t.name === opts.trackName),
  );
  const reachable = new Set<string>();
  for (const tr of tracks) for (const seg of tr.segments) reachable.add(seg.material_id);

  const texts = draft.materials.texts as unknown as Array<Record<string, unknown>>;
  let materialsPatched = 0;
  for (let i = 0; i < texts.length; i++) {
    if (reachable.has(texts[i].id as string)) {
      texts[i] = restyleMaterial(texts[i], materialFields, spanStyle);
      materialsPatched++;
    }
  }

  let segmentsPatched = 0;
  for (const tr of tracks) {
    (tr as unknown as Record<string, unknown>).is_default_name = false;
    for (const seg of tr.segments) {
      // Graft preset.segment fields; identity/timing (id/material_id/target_timerange/
      // source_timerange/extra_material_refs) survive — the preset never carries them.
      for (const [k, v] of Object.entries(segmentFields)) {
        (seg as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(v));
      }
      segmentsPatched++;
    }
  }

  saveDraft(filePath, draft);
  return { materialsPatched, segmentsPatched };
}

// --- CLI wrapper ---

export function cmdRestyle(draft: Draft, filePath: string, _positional: string[], flags: Flags): void {
  if (!flags.preset) {
    die(
      "Missing --preset <preset.json>. Usage: capcut-david restyle <project> --preset <preset.json> [--track-name <name>]",
    );
  }
  if (!existsSync(flags.preset)) die(`Preset file not found: ${flags.preset}`);
  let preset: CaptionStylePreset;
  try {
    preset = JSON.parse(readFileSync(flags.preset, "utf-8")) as CaptionStylePreset;
  } catch (e) {
    die(`Invalid JSON in ${flags.preset}: ${(e as Error).message}`);
  }
  if (!preset || typeof preset !== "object" || !preset.text_material || !preset.content_template) {
    die("Preset must be an object with text_material + content_template (+ segment) — see preset_captions_style.json");
  }
  const res = applyCaptionStyle(draft, filePath, { preset, trackName: flags.trackName });
  out({ ok: true, materials_patched: res.materialsPatched, segments_patched: res.segmentsPatched }, flags);
}
