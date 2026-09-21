import { existsSync, readFileSync } from "node:fs";
import type { Draft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { applyCaptionStyle, type CaptionStylePreset } from "./restyle.js";

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
  out(
    {
      ok: true,
      materials_patched: res.materialsPatched,
      segments_patched: res.segmentsPatched,
      mirrored: res.mirrored,
    },
    flags,
  );
}
