#!/usr/bin/env node

import { cmdBatch } from "./commands/batch.js";
import {
  cmdAddAudio,
  cmdAddEffect,
  cmdAddText,
  cmdAddVideo,
  cmdAddVideoBatch,
  cmdImportCaptions,
  cmdInit,
} from "./commands/create.js";
import { cmdCut } from "./commands/cut.js";
import { cmdOpacity, cmdSetText, cmdShift, cmdShiftAll, cmdSpeed, cmdTrim, cmdVolume } from "./commands/edit.js";
import { cmdGc } from "./commands/gc.js";
import { cmdInitMeta } from "./commands/init-meta.js";
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
import { cmdMakePreset } from "./commands/make-preset.js";
import { cmdPsychoBuild } from "./commands/pipeline.js";
import { cmdQuery } from "./commands/query.js";
import { cmdRegister } from "./commands/register.js";
import { cmdRestyle } from "./commands/restyle.js";
import { cmdSyncTimelines } from "./commands/sync-timelines.js";
import { cmdApplyTemplate, cmdSaveTemplate } from "./commands/template.js";
import { cmdValidate } from "./commands/validate.js";
import { cmdValidateFix } from "./commands/validate-fix.js";
import { loadDraft } from "./draft.js";
import { assertCapCutClosed, WRITE_COMMANDS } from "./utils/capcut-guard.js";
import { CliError, die, type Flags, requireArgs } from "./utils/cli.js";

const HELP = `capcut-david — CapCut/JianYing draft CLI (fork of capcut-cli)

Usage: capcut-david <command> <project> [options]

  <project> = path to draft_content.json, draft_info.json, or their parent directory

Global flags:
  -H, --human     Human-readable table output (default: JSON)
  -q, --quiet     No output on success, exit code only (write commands)
      --force     Write even if CapCut is running (skips the open-CapCut guard;
                  CapCut overwrites the draft on close — use only for automation).
                  Env equivalent: CAPCUT_DAVID_FORCE=1

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
  init       <name> [--template <dir>] [--drafts <dir>] [--width <n> --height <n>]
             Create a new empty draft from template.

Add:
  add-audio  <project> <file> <start> <duration> [--volume <n>] [--track-name <s>]
  add-video  <project> <file> <start> <duration> [--track-name <s>]
             Media is copied into <draft>/Resources/ and referenced by a portable
             draftpath token (rename/duplication-safe — orchestrator version gate).
  add-video  <project> --batch @items.json
             batch: [{path,start,duration,width?,height?,volume?,trackName?}]
             — ordered segment_ids out; all-or-nothing, one save.
  add-text   <project> <start> <duration> <text>
              [--font-size <n>] [--color <hex>] [--align <0|1|2>]
              [--x <n>] [--y <n>] [--track-name <s>]
              [--keyword <word> | --keyword-range <s,e>] [--keyword-color <hex>]
              [--keyword-size <n>]
              Keyword highlight: color one word/range (default #FFD600);
              --keyword-size sets the highlighted word's font size (points).
  import-captions <project> <captions.json> [--color <hex>] [--highlight-color <hex>]
              [--highlight-size <n>] [--transform-y <n>] [--track-name <s>] [--clone-style]
              Batch word/keyword captions from [{text,start,end,hl?,color?,hlSize?}];
              replaces the text track (start/end in microseconds).
              --highlight-size: default font size for hl spans (per-card hlSize wins).
              --transform-y: clip.transform.y for every rebuilt caption segment
              (vertical position; negatives allowed, e.g. -0.4 = mi-bas).
              --clone-style: keep the target track's existing caption font/stroke/shadow.
  add-effect <project> <resource-id> <name> <start> <duration>
              [--value <n>] [--bind <segment-id>]
              Apply a video effect (FX) via its catalogue resource ID.

Style:
  restyle    <project> --preset <preset.json> [--track-name <s>]
              Apply a caption style preset (font/stroke/shadow/size) to every
              caption. Span-aware: keyword-highlight colors + ranges survive.
              Default targets all text tracks; --track-name scopes to one.

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

Pipeline:
  psycho-build <manifest.yaml> [--out <dir>] [--seed <n>]
               [--register] [--projects-root <dir>]
               Build a complete TikTok-format draft from a YAML manifest
               (images + ken-burns + voice + music + SRT captions).
               --register: also index the draft so it appears in CapCut's UI.

Register:
  register   <draft-dir> [--projects-root <dir>]
               Append a built draft to CapCut's root_meta_info.json so it
               shows up in the CapCut UI. Idempotent.
  init-meta  <project> [--force] [--register] [--projects-root <dir>] [--dry-run]
               Generate a MISSING draft_meta_info.json next to draft_content.json
               (fixes validate's meta.missing). Refuses if one already exists
               (--force to overwrite, writes a .bak first). --register chains
               register. Writes only the sidecar; keep CapCut CLOSED.

Validate:
  validate   <project> [-H] [-q] [--strict] [--id <id>] [--skip <id>]
             [--check-assets] [--check-timelines] [--projects-root <dir>]
             Read-only linter — detects dangling refs, orphans, duplicate ids,
             zero/under/overrun durations, overlaps and canvas sanity BEFORE you
             open CapCut. Never writes. Exit 0 = clean, 2 = problems found,
             1 = tool failure. --strict promotes warnings to the failure code.
             --check-assets/--check-timelines enable the opt-in disk checks.
  validate   <project> --fix [--apply] [--id <id>] [--skip <id>] [--strict]
             Aggregate auto-fixer. DRY-RUN BY DEFAULT: --fix alone previews the
             plan (zero writes); add --apply to write. Maps each fixable finding
             to its fixer and runs them in dependency order: gc (DESTRUCTIVE:
             removes orphan materials) → init-meta → register → sync-timelines
             (always last). Re-validates after applying; exit reflects the
             residual. Refuses on dangling-ref/duplicate-id drafts. --apply
             requires CapCut CLOSED. --id/--skip select which findings to fix.
  sync-timelines <project> [--dry-run] [-H] [-q] [--force]
             Repair a stale CapCut timeline mirror: copy the root
             draft_content.json into every Timelines/<guid>/ (+ template-2.tmp).
             Fixes validate's timelines.divergence. Direction is always
             root → mirror; timestamped backups (…synced-<epoch>.bak) are kept.
             --dry-run reports without writing. Keep CapCut CLOSED (write guard).

Garbage-collect:
  gc         <project> [--dry-run] [-H] [-q] [--force]
             Remove orphan text/video/audio materials (those validate reports as
             orphan_text/orphan_media — e.g. import-captions leftovers). JSON-only:
             never deletes a disk asset. Refuses on a dangling-ref/duplicate-id
             draft. No-op writes nothing. --dry-run previews. Run sync-timelines
             after (the root then diverges from any Timelines/ mirrors).

Catalogue:
  query      <term> [--kind effect|filter|transition|font] [--drafts <dir>]
             Search the CapCut drafts library (every draft under the projects
             root) for effects, filters, transitions and fonts. <term> =
             case-insensitive substring on the item name. Read-only. Results
             dedupe by resource_id (local fonts by name+path) and list
             from_drafts[]. JSON (or -H table). Exit 0 even on zero matches;
             2 if the drafts root is missing or all drafts are unreadable.

  make-preset --font <name|resource_id> [--out <file>] [--drafts <dir>]
             Generate a BARE-FONT restyle preset for a font already used in your
             drafts library (the generation cousin of query). Reads the font's
             resource_id / .ttf path / catalogue title from a draft that uses it
             and emits a preset ready for \`restyle --preset\`. --out writes the
             preset file; otherwise it's in the JSON envelope. Read-only. Exit 0
             (incl. no-match / ambiguous), 2 if the drafts root is missing or the
             matched font is local-only (no resource_id), 1 on usage error.

Project:
  cut        <project> <start> <end> --out <path>

Navigation: info → tracks/materials → segments → segment <id>
            info → materials --type X → material <id>
Time formats: 1.5s, 500ms, 1:30, +0.5s, -200ms
IDs: first 6+ chars of segment/material ID (prefix match)`;

/** Font-size flag value: a finite number > 0 (NaN/Infinity/zero/negative → die). */
function parseSizeFlag(flag: string, raw: string): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) die(`${flag} must be a positive number (font size in points), got "${raw}"`);
  return v;
}

/** Transform flag value: any finite number — negatives and zero allowed (≠ parseSizeFlag).
    Empty string is rejected explicitly (Number("") === 0 would silently pass). */
function parseFiniteFlag(flag: string, raw: string): number {
  const v = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(v)) die(`${flag} must be a finite number, got "${raw}"`);
  return v;
}

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
      flags.align = parseInt(args[++i], 10);
    } else if (a === "--x" && i + 1 < args.length) {
      flags.x = parseFloat(args[++i]);
    } else if (a === "--y" && i + 1 < args.length) {
      flags.y = parseFloat(args[++i]);
    } else if (a === "--width" && i + 1 < args.length) {
      flags.width = parseInt(args[++i], 10);
    } else if (a === "--height" && i + 1 < args.length) {
      flags.height = parseInt(args[++i], 10);
    } else if (a === "--track-name" && i + 1 < args.length) {
      flags.trackName = args[++i];
    } else if (a === "--volume" && i + 1 < args.length) {
      flags.volume = parseFloat(args[++i]);
    } else if (a === "--template" && i + 1 < args.length) {
      flags.template = args[++i];
    } else if (a === "--drafts" && i + 1 < args.length) {
      flags.drafts = args[++i];
    } else if (a === "--font" && i + 1 < args.length) {
      flags.font = args[++i];
    } else if (a === "--kind" && i + 1 < args.length) {
      flags.kind = args[++i];
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
    } else if (a === "--seed" && i + 1 < args.length) {
      flags.seed = args[++i];
    } else if (a === "--bind" && i + 1 < args.length) {
      flags.bind = args[++i];
    } else if (a === "--register") {
      flags.register = true;
    } else if (a === "--projects-root" && i + 1 < args.length) {
      flags.projectsRoot = args[++i];
    } else if (a === "--keyword" && i + 1 < args.length) {
      flags.keyword = args[++i];
    } else if (a === "--keyword-range" && i + 1 < args.length) {
      flags.keywordRange = args[++i];
    } else if (a === "--keyword-color" && i + 1 < args.length) {
      flags.keywordColor = args[++i];
    } else if (a === "--keyword-size" && i + 1 < args.length) {
      flags.keywordSize = parseSizeFlag(a, args[++i]);
    } else if (a === "--highlight-color" && i + 1 < args.length) {
      flags.highlightColor = args[++i];
    } else if (a === "--highlight-size" && i + 1 < args.length) {
      flags.highlightSize = parseSizeFlag(a, args[++i]);
    } else if (a === "--transform-y" || a.startsWith("--transform-y=")) {
      // Position correctness is the whole point of this flag — refuse the two malformed
      // forms that would otherwise fall through to ignored positionals and silently
      // recenter every caption at y=0 with exit 0.
      if (a !== "--transform-y") die(`--transform-y takes a space-separated value (use --transform-y <n>), got "${a}"`);
      if (i + 1 >= args.length) die("--transform-y requires a value (e.g. --transform-y -0.4)");
      flags.transformY = parseFiniteFlag(a, args[++i]);
    } else if (a === "--clone-style") {
      flags.cloneStyle = true;
    } else if (a === "--force") {
      flags.force = true;
    } else if (a === "--strict") {
      flags.strict = true;
    } else if (a === "--check-assets") {
      flags.checkAssets = true;
    } else if (a === "--check-timelines") {
      flags.checkTimelines = true;
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--fix") {
      flags.fix = true;
    } else if (a === "--apply") {
      flags.apply = true;
    } else if (a === "--id" && i + 1 < args.length) {
      if (!flags.ids) flags.ids = [];
      flags.ids.push(args[++i]);
    } else if (a === "--skip" && i + 1 < args.length) {
      if (!flags.skip) flags.skip = [];
      flags.skip.push(args[++i]);
    } else if (a === "--preset" && i + 1 < args.length) {
      flags.preset = args[++i];
    } else if (a === "--batch" && i + 1 < args.length) {
      flags.batch = args[++i];
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

  // Preflight: refuse to write while CapCut is open (silent-overwrite footgun).
  if (WRITE_COMMANDS.has(cmd)) assertCapCutClosed(flags);

  if (cmd === "init") {
    cmdInit(positional, flags);
    process.exit(0);
  }

  if (cmd === "psycho-build") {
    cmdPsychoBuild(positional, flags);
    process.exit(0);
  }

  if (cmd === "register") {
    cmdRegister(positional, flags);
    process.exit(0);
  }

  if (cmd === "init-meta") {
    cmdInitMeta(positional, flags);
    process.exit(0);
  }

  if (cmd === "query") {
    process.exit(cmdQuery(positional, flags));
  }

  if (cmd === "make-preset") {
    process.exit(cmdMakePreset(flags));
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
      if (flags.batch !== undefined) {
        if (positional.length > 2) die("--batch cannot be combined with a positional file");
        cmdAddVideoBatch(draft, filePath, flags);
      } else {
        requireArgs(positional, 5, "capcut-david add-video <project> <file> <start> <duration>");
        cmdAddVideo(draft, filePath, positional, flags);
      }
      break;
    case "add-text":
      requireArgs(positional, 5, "capcut-david add-text <project> <start> <duration> <text>");
      cmdAddText(draft, filePath, positional, flags);
      break;
    case "import-captions":
      requireArgs(positional, 3, "capcut-david import-captions <project> <captions.json>");
      cmdImportCaptions(draft, filePath, positional, flags);
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
    case "add-effect":
      requireArgs(
        positional,
        6,
        "capcut-david add-effect <project> <resource-id> <name> <start> <duration> [--value <n>] [--bind <segment-id>]",
      );
      cmdAddEffect(draft, filePath, positional, flags);
      break;
    case "restyle":
      requireArgs(positional, 2, "capcut-david restyle <project> --preset <preset.json> [--track-name <name>]");
      cmdRestyle(draft, filePath, positional, flags);
      break;
    case "validate":
      if (flags.fix) process.exit(cmdValidateFix(draft, filePath, projectPath, flags));
      process.exit(cmdValidate(draft, filePath, projectPath, flags));
      break;
    case "sync-timelines":
      cmdSyncTimelines(draft, filePath, positional, flags);
      break;
    case "gc":
      cmdGc(draft, filePath, positional, flags);
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
