// Generate a bare-font `restyle` preset for a font found in the CapCut drafts
// library. The generation cousin of `query`: scans every draft under the
// projects root (or --drafts), finds a font by NAME (case-insensitive substring,
// or exact resource_id if the arg is numeric), and emits a ready-to-use preset
// carrying ONLY the font identity (no stroke/shadow/size). Never writes a draft.
// Spec: docs/superpowers/specs/2026-06-07-make-preset-design.md
import { type FontCandidate, type FontPlanResult, planFontCandidates } from "../utils/font-resolver.js";

export type PlanResult = FontPlanResult;

// Keep make-preset's historical pure API while sharing the extraction, dedupe,
// matching and ambiguity rules with cascade-words.
export function planMakePreset(drafts: Array<{ name: string; draft: unknown }>, font: string): PlanResult {
  return planFontCandidates(drafts, font);
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
