// Persistent, append-only record of every CapCut resource seen in the drafts
// library. Where `query` is stateless (delete a draft, lose the resource_id),
// this file remembers forever and carries the human's hand-written notes.
// Frozen design: docs/superpowers/specs/2026-08-07-catalogue-design.md
import type { RawItem } from "./query.js";

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
