import { existsSync, readFileSync } from "node:fs";
import { type Draft, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { type FontCalibrationProfile, parseFontCalibrationProfiles } from "../utils/font-calibration.js";
import { resolveFontReference } from "../utils/font-resolver.js";
import { cascadeWords } from "./cascade-words.js";
import type { CaptionCard } from "./create.js";

export function cmdCascadeWords(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const jsonPath = positional[2];
  if (!jsonPath) {
    die(
      "Missing <cards.json>. Usage: capcut-david cascade-words <project> <cards.json> --guide-track <name> (--font <name|rid> | --clone-style) [--track-prefix <name>] [--line-prefix <name>] [--font-size <n>] [--color <hex>] [--highlight-color <hex>] [--align <0|1|2>] [--drafts <dir>] [--font-calibration <file>]",
    );
  }
  if (!existsSync(jsonPath)) die(`Cards file not found: ${jsonPath}`);
  let cards: CaptionCard[];
  try {
    cards = JSON.parse(readFileSync(jsonPath, "utf-8")) as CaptionCard[];
  } catch (e) {
    die(`Invalid JSON in ${jsonPath}: ${(e as Error).message}`);
  }
  if (!Array.isArray(cards)) die("Cards file must be a JSON array of {text,start,end}");
  if (!flags.guideTrack) die("--guide-track <name> is required");

  let fontCalibrationProfiles: FontCalibrationProfile[] | undefined;
  if (flags.fontCalibration) {
    if (!existsSync(flags.fontCalibration)) die(`Font calibration file not found: ${flags.fontCalibration}`);
    try {
      fontCalibrationProfiles = parseFontCalibrationProfiles(
        JSON.parse(readFileSync(flags.fontCalibration, "utf-8")) as unknown,
      );
    } catch (e) {
      die(`Invalid font calibration file ${flags.fontCalibration}: ${(e as Error).message}`);
    }
  }

  const result = cascadeWords(draft, filePath, {
    cards,
    guideTrackName: flags.guideTrack,
    trackPrefix: flags.trackPrefix,
    linePrefix: flags.linePrefix,
    fontSize: flags.fontSize,
    color: flags.color,
    highlightColor: flags.highlightColor,
    alignment: flags.align,
    cloneStyle: flags.cloneStyle,
    alphaLines: flags.alphaLines,
    fontCalibrationProfiles,
    allowCandidateCalibration: flags.allowCandidateCalibration,
    font: flags.font ? resolveFontReference(flags.font, { draftsRoot: flags.drafts }) : undefined,
  });
  saveDraft(filePath, draft);
  out({ ok: true, track_ids: result.trackIds, word_count: result.wordCount, line_count: result.lineCount }, flags);
}
