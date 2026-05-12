#!/usr/bin/env node

import { cmdBatch } from "./commands/batch.js";
import { cmdAddAudio, cmdAddText, cmdAddVideo, cmdInit } from "./commands/create.js";
import { cmdCut } from "./commands/cut.js";
import { cmdOpacity, cmdSetText, cmdShift, cmdShiftAll, cmdSpeed, cmdTrim, cmdVolume } from "./commands/edit.js";
import {
  cmdExportSrt,
  cmdInfo,
  cmdMaterialDetail,
  cmdMaterials,
  cmdSegmentDetail,
  cmdSegments,
  cmdTexts,
  cmdTracks,
} from "./commands/inspect.js";
import { cmdAddKeyframe, cmdKenBurns } from "./commands/keyframe.js";
import { cmdApplyTemplate, cmdSaveTemplate } from "./commands/template.js";
import { loadDraft } from "./draft.js";
import { CliError, die, type Flags, requireArgs } from "./utils/cli.js";

const HELP = `capcut-david — CapCut/JianYing draft CLI (fork of capcut-cli)

Usage: capcut-david <command> <project> [options]

  <project> = path to draft_content.json, draft_info.json, or their parent directory

Global flags:
  -H, --human     Human-readable table output (default: JSON)
  -q, --quiet     No output on success, exit code only (write commands)

Overview (start here):
  info       <project>                          Project overview + material summary
  tracks     <project>                          List all tracks
  materials  <project>                          List all material types + counts
  materials  <project> --type <type>            List items of one material type

Browse:
  segments   <project> [--track <type>]         List segments with timing
  texts      <project>                          List all text/subtitle content

Detail (drill into one item):
  segment    <project> <id>                     Full detail for one segment + its material
  material   <project> <id>                     Full detail for one material

Create:
  init       <name> [--template <dir>] [--drafts <dir>]
             Create a new empty draft from template.

Add:
  add-audio  <project> <file> <start> <duration> [--volume <n>] [--track-name <s>]
  add-video  <project> <file> <start> <duration> [--track-name <s>]
  add-text   <project> <start> <duration> <text>
             [--font-size <n>] [--color <hex>] [--align <0|1|2>]
             [--x <n>] [--y <n>] [--track-name <s>]

Edit:
  set-text   <project> <id> <text>              Change text content
  shift      <project> <id> <offset>            Shift segment timing (e.g. +0.5s, -1s)
  shift-all  <project> <offset> [--track <type>] Shift all segments on a track
  speed      <project> <id> <multiplier>        Set playback speed
  volume     <project> <id> <level>             Set volume (0.0-1.0)
  trim       <project> <id> <start> <duration>  Trim segment (times in seconds)
  opacity    <project> <id> <alpha>             Set opacity (0.0-1.0)
  export-srt <project>                          Export subtitles to SRT
  batch      <project>                          Run multiple edits from stdin (JSONL)

Keyframes:
  add-keyframe <project> <id> <time> --property <p> --value <v> [--curve <c>]
               Insert/update a keyframe at <time> on <id>.
               Properties: scale_x, scale_y, position_x, position_y, rotation, alpha
               Curves:     linear (default), ease-in, ease-out, ease-in-out
  ken-burns    <project> <id> --from <scale> --to <scale> [--curve <c>]
               Apply a Ken Burns zoom — paired scale_x/scale_y keyframes
               from t=0 to t=segment.duration. Default curve: ease-out.

Templates:
  save-template  <project> <id> <name> --out <path>
  apply-template <project> <template.json> <start> <duration> [text override]
                 [--x <n>] [--y <n>]

Project:
  cut        <project> <start> <end> --out <path>

Navigation: info → tracks/materials → segments → segment <id>
            info → materials --type X → material <id>
Time formats: 1.5s, 500ms, 1:30, +0.5s, -200ms
IDs: first 6+ chars of segment/material ID (prefix match)`;

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = { human: false, quiet: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-H" || a === "--human") flags.human = true;
    else if (a === "-q" || a === "--quiet") flags.quiet = true;
    else if ((a === "--track" || a === "--type") && i + 1 < args.length) {
      flags.track = args[++i];
    } else if (a === "--out" && i + 1 < args.length) {
      flags.out = args[++i];
    } else if (a === "--font-size" && i + 1 < args.length) {
      flags.fontSize = parseFloat(args[++i]);
    } else if (a === "--color" && i + 1 < args.length) {
      flags.color = args[++i];
    } else if (a === "--align" && i + 1 < args.length) {
      flags.align = parseInt(args[++i]);
    } else if (a === "--x" && i + 1 < args.length) {
      flags.x = parseFloat(args[++i]);
    } else if (a === "--y" && i + 1 < args.length) {
      flags.y = parseFloat(args[++i]);
    } else if (a === "--track-name" && i + 1 < args.length) {
      flags.trackName = args[++i];
    } else if (a === "--volume" && i + 1 < args.length) {
      flags.volume = parseFloat(args[++i]);
    } else if (a === "--template" && i + 1 < args.length) {
      flags.template = args[++i];
    } else if (a === "--drafts" && i + 1 < args.length) {
      flags.drafts = args[++i];
    } else if (a === "--property" && i + 1 < args.length) {
      flags.property = args[++i];
    } else if (a === "--value" && i + 1 < args.length) {
      flags.value = args[++i];
    } else if (a === "--curve" && i + 1 < args.length) {
      flags.curve = args[++i];
    } else if (a === "--from" && i + 1 < args.length) {
      flags.from = args[++i];
    } else if (a === "--to" && i + 1 < args.length) {
      flags.to = args[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function main(): void {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw[0] === "--help" || raw[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const { positional, flags } = parseFlags(raw);
  const cmd = positional[0];
  const projectPath = positional[1];

  if (cmd === "init") {
    cmdInit(positional, flags);
    process.exit(0);
  }

  if (!projectPath) die("Missing project path. Run 'capcut-david --help' for usage.");

  const { draft, filePath } = loadDraft(projectPath);

  switch (cmd) {
    case "info":
      cmdInfo(draft, flags);
      break;
    case "tracks":
      cmdTracks(draft, flags);
      break;
    case "segments":
      cmdSegments(draft, flags);
      break;
    case "texts":
      cmdTexts(draft, flags);
      break;
    case "set-text":
      requireArgs(positional, 4, "capcut-david set-text <project> <id> <text>");
      cmdSetText(draft, filePath, positional[2], positional.slice(3).join(" "), flags);
      break;
    case "shift":
      requireArgs(positional, 4, "capcut-david shift <project> <id> <offset>");
      cmdShift(draft, filePath, positional[2], positional[3], flags);
      break;
    case "shift-all":
      requireArgs(positional, 3, "capcut-david shift-all <project> <offset> [--track <type>]");
      cmdShiftAll(draft, filePath, positional[2], flags);
      break;
    case "speed":
      requireArgs(positional, 4, "capcut-david speed <project> <id> <multiplier>");
      cmdSpeed(draft, filePath, positional[2], positional[3], flags);
      break;
    case "volume":
      requireArgs(positional, 4, "capcut-david volume <project> <id> <level>");
      cmdVolume(draft, filePath, positional[2], positional[3], flags);
      break;
    case "trim":
      requireArgs(positional, 5, "capcut-david trim <project> <id> <start> <duration>");
      cmdTrim(draft, filePath, positional[2], positional[3], positional[4], flags);
      break;
    case "opacity":
      requireArgs(positional, 4, "capcut-david opacity <project> <id> <alpha>");
      cmdOpacity(draft, filePath, positional[2], positional[3], flags);
      break;
    case "export-srt":
      cmdExportSrt(draft);
      break;
    case "materials":
      cmdMaterials(draft, flags);
      break;
    case "segment":
      requireArgs(positional, 3, "capcut-david segment <project> <id>");
      cmdSegmentDetail(draft, positional[2], flags);
      break;
    case "material":
      requireArgs(positional, 3, "capcut-david material <project> <id>");
      cmdMaterialDetail(draft, positional[2], flags);
      break;
    case "add-audio":
      requireArgs(positional, 5, "capcut-david add-audio <project> <file> <start> <duration>");
      cmdAddAudio(draft, filePath, positional, flags);
      break;
    case "add-video":
      requireArgs(positional, 5, "capcut-david add-video <project> <file> <start> <duration>");
      cmdAddVideo(draft, filePath, positional, flags);
      break;
    case "add-text":
      requireArgs(positional, 5, "capcut-david add-text <project> <start> <duration> <text>");
      cmdAddText(draft, filePath, positional, flags);
      break;
    case "cut":
      requireArgs(positional, 4, "capcut-david cut <project> <start> <end> --out <path>");
      cmdCut(draft, filePath, positional, flags);
      break;
    case "save-template":
      requireArgs(positional, 4, "capcut-david save-template <project> <id> <name> --out <path>");
      cmdSaveTemplate(draft, positional, flags);
      break;
    case "apply-template":
      requireArgs(positional, 5, "capcut-david apply-template <project> <template.json> <start> <duration>");
      cmdApplyTemplate(draft, filePath, positional, flags);
      break;
    case "batch":
      cmdBatch(draft, filePath, flags);
      break;
    case "add-keyframe":
      requireArgs(positional, 4, "capcut-david add-keyframe <project> <id> <time> --property <p> --value <v>");
      cmdAddKeyframe(draft, filePath, positional[2], positional[3], flags.property, flags.value, flags.curve, flags);
      break;
    case "ken-burns":
      requireArgs(positional, 3, "capcut-david ken-burns <project> <id> --from <scale> --to <scale>");
      cmdKenBurns(draft, filePath, positional[2], flags.from, flags.to, flags.curve, flags);
      break;
    default:
      die(`Unknown command: ${cmd}. Run 'capcut-david --help' for usage.`);
  }
}

try {
  main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!(e instanceof CliError)) {
    // Unexpected error — still print, but we exit nonzero either way.
  }
  process.stderr.write(`${JSON.stringify({ error: msg })}\n`);
  process.exit(1);
}
