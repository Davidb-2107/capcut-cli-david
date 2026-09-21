import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Draft, saveDraft } from "../draft.js";
import { defaultProjectsRoot, resolveTemplateDir } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { hexToRgb } from "../utils/companion.js";
import { parseTimeInput } from "../utils/time.js";
import {
  type AddAudioOptions,
  addAudio,
  type AddEffectOptions,
  addEffect,
  addFilter,
  addText,
  type AddTextOptions,
  addTransition,
  type AddVideoOptions,
  addVideo,
  DEFAULT_HIGHLIGHT_COLOR,
  importCaptions,
  initDraft,
  type CaptionCard,
  type TextHighlight,
} from "./create.js";

// --- CLI wrappers ---

export function cmdInit(positional: string[], flags: Flags): void {
  const name = positional[1];
  if (!name) die("Missing name. Usage: capcut-david init <name> [--template <dir>] [--drafts <dir>]");
  let templateDir: string;
  try {
    templateDir = flags.template ?? resolveTemplateDir();
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
  const draftsDir = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true });
  const oneSided = (flags.width === undefined) !== (flags.height === undefined);
  if (oneSided) die("--width and --height must be given together");
  if (
    (flags.width !== undefined && (Number.isNaN(flags.width) || flags.width <= 0)) ||
    (flags.height !== undefined && (Number.isNaN(flags.height) || flags.height <= 0))
  ) {
    die("--width and --height must be positive integers");
  }
  const result = initDraft({ name, templateDir, draftsDir, width: flags.width, height: flags.height });
  out({ ok: true, name, draft_path: result.draftPath, file_path: result.filePath }, flags);
  if (!flags.quiet) process.stderr.write(`Created: ${result.draftPath}\n`);
}

export function cmdAddAudio(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const audioPath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  if (!audioPath || !startStr || !durationStr) {
    die("Usage: capcut-david add-audio <project> <file> <start> <duration>");
  }
  // resolve() returns a normalized absolute path: kept as-is when already absolute
  // (incl. Windows `C:\…`), otherwise joined onto cwd — correct on Win + POSIX.
  const absPath = resolve(audioPath);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddAudioOptions = {
    path: absPath,
    start,
    duration,
    volume: flags.volume,
    trackName: flags.trackName,
  };
  const result = addAudio(draft, filePath, opts);
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      path: absPath,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

export function cmdAddVideo(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const videoPath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  if (!videoPath || !startStr || !durationStr) {
    die("Usage: capcut-david add-video <project> <file> <start> <duration>");
  }
  // resolve() returns a normalized absolute path: kept as-is when already absolute
  // (incl. Windows `C:\…`), otherwise joined onto cwd — correct on Win + POSIX.
  const absPath = resolve(videoPath);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddVideoOptions = {
    path: absPath,
    start,
    duration,
    trackName: flags.trackName,
  };
  const result = addVideo(draft, filePath, opts);
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      path: absPath,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

interface MediaBatchItem {
  path: string;
  start: number | string;
  duration: number | string;
  width?: number;
  height?: number;
  volume?: number;
  trackName?: string;
}

/** Resolve `@file` (or bare path), parse JSON, require a non-empty array. */
export function readBatchItems(spec: string, verb: string): MediaBatchItem[] {
  const p = resolve(spec.startsWith("@") ? spec.slice(1) : spec);
  if (!existsSync(p)) die(`--batch file not found: ${p}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    die(`--batch file is not valid JSON (${p}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) die(`--batch expects a JSON array of items (${verb})`);
  if (parsed.length === 0) die(`--batch array is empty (${verb})`);
  return parsed as MediaBatchItem[];
}

/** Validate one media item; returns normalized {path, start, duration, ...}. 1-based index in errors. */
function normalizeMediaItem(raw: MediaBatchItem, idx: number, verb: string) {
  const label = `${verb} --batch item ${idx}`;
  if (typeof raw.path !== "string" || raw.path === "") die(`${label}: "path" (string) is required`);
  const abs = resolve(raw.path);
  if (!existsSync(abs)) die(`${label}: file not found: ${abs}`);
  const t = (v: number | string, field: string): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return parseTimeInput(v);
    die(`${label}: "${field}" must be a number (µs) or time string`);
  };
  if (raw.start === undefined || raw.duration === undefined) die(`${label}: "start" and "duration" are required`);
  return { ...raw, path: abs, start: t(raw.start, "start"), duration: t(raw.duration, "duration") };
}

export function cmdAddVideoBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-video");
  // all-or-nothing: validate EVERY item before the first mutation
  const items = raw.map((it, i) => normalizeMediaItem(it, i + 1, "add-video"));
  const segment_ids: string[] = [];
  const material_ids: string[] = [];
  const track_ids: string[] = [];
  for (const it of items) {
    const r = addVideo(draft, filePath, {
      path: it.path,
      start: it.start,
      duration: it.duration,
      width: it.width,
      height: it.height,
      volume: it.volume,
      trackName: it.trackName,
    });
    segment_ids.push(r.segmentId);
    material_ids.push(r.materialId);
    track_ids.push(r.trackId);
  }
  saveDraft(filePath, draft); // ONE save
  out({ ok: true, count: items.length, segment_ids, material_ids, track_ids }, flags);
}

export function cmdAddAudioBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-audio");
  // all-or-nothing: validate EVERY item before the first mutation
  const items = raw.map((it, i) => normalizeMediaItem(it, i + 1, "add-audio"));
  const segment_ids: string[] = [];
  const material_ids: string[] = [];
  const track_ids: string[] = [];
  for (const it of items) {
    const r = addAudio(draft, filePath, {
      path: it.path,
      start: it.start,
      duration: it.duration,
      volume: it.volume,
      trackName: it.trackName,
    });
    segment_ids.push(r.segmentId);
    material_ids.push(r.materialId);
    track_ids.push(r.trackId);
  }
  saveDraft(filePath, draft); // ONE save
  out({ ok: true, count: items.length, segment_ids, material_ids, track_ids }, flags);
}

/**
 * Resolve keyword-highlight flags into a TextHighlight[]. Precedence:
 * --keyword-range (explicit code-unit offsets) > --keyword (first substring
 * occurrence). Bounds are validated downstream by buildRichTextContent.
 */
function parseKeywordFlags(text: string, flags: Flags): TextHighlight[] {
  const color = hexToRgb(flags.keywordColor ?? DEFAULT_HIGHLIGHT_COLOR);
  const size = flags.keywordSize;
  if (flags.keywordRange !== undefined) {
    const parts = flags.keywordRange.split(",").map((x) => x.trim());
    const nums = parts.map(Number); // Number() (not parseInt) so "1.5" is rejected, not truncated
    if (parts.length !== 2 || parts.some((p) => p === "") || nums.some((v) => !Number.isInteger(v))) {
      die(`--keyword-range must be two integers "start,end" in UTF-16 code units, got "${flags.keywordRange}"`);
    }
    return [{ range: [nums[0], nums[1]], color, size }];
  }
  if (flags.keyword !== undefined) {
    const idx = text.indexOf(flags.keyword);
    if (idx < 0) die(`--keyword "${flags.keyword}" not found in caption text`);
    return [{ range: [idx, idx + flags.keyword.length], color, size }];
  }
  return [];
}

export function cmdAddText(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const startStr = positional[2];
  const durationStr = positional[3];
  const text = positional.slice(4).join(" ");
  if (!text) die("Missing text. Usage: capcut-david add-text <project> <start> <duration> <text>");
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const opts: AddTextOptions = {
    text,
    start,
    duration,
    fontSize: flags.fontSize,
    color: flags.color,
    alignment: flags.align,
    x: flags.x,
    y: flags.y,
    trackName: flags.trackName,
    highlights: parseKeywordFlags(text, flags),
  };
  const result = addText(draft, filePath, opts);
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      text,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

export function cmdImportCaptions(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const jsonPath = positional[2];
  if (!jsonPath) {
    die(
      "Missing <captions.json>. Usage: capcut-david import-captions <project> <captions.json> [--color <hex>] [--color-cycle <hex,hex,...>] [--highlight-color <hex>] [--highlight-size <n>] [--transform-y <n>] [--track-name <name>]",
    );
  }
  if (!existsSync(jsonPath)) die(`Captions file not found: ${jsonPath}`);
  let cards: CaptionCard[];
  try {
    cards = JSON.parse(readFileSync(jsonPath, "utf-8")) as CaptionCard[];
  } catch (e) {
    die(`Invalid JSON in ${jsonPath}: ${(e as Error).message}`);
  }
  if (!Array.isArray(cards)) die("Captions file must be a JSON array of {text,start,end,hl?,color?,hlSize?}");

  const result = importCaptions(draft, filePath, {
    cards,
    trackName: flags.trackName,
    highlightColor: flags.highlightColor ?? flags.keywordColor,
    highlightSize: flags.highlightSize ?? flags.keywordSize,
    fontSize: flags.fontSize,
    color: flags.color,
    colorCycle: flags.colorCycle,
    alignment: flags.align,
    transformY: flags.transformY,
    cloneStyle: flags.cloneStyle,
  });
  saveDraft(filePath, draft);
  out({ ok: true, track_id: result.trackId, captions: result.count }, flags);
}

/** Resolve <start>/<duration> from positionals, or the whole timeline when --full. */
function resolveRange(
  draft: Draft,
  positional: string[],
  flags: Flags,
  usage: string,
): { start: number; duration: number } {
  if (flags.full) {
    if (typeof draft.duration !== "number" || draft.duration <= 0) die("--full: draft has no duration");
    return { start: 0, duration: draft.duration };
  }
  const startStr = positional[4];
  const durationStr = positional[5];
  if (!startStr || !durationStr) die(usage);
  return { start: parseTimeInput(startStr), duration: parseTimeInput(durationStr) };
}

export function cmdAddEffect(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const resourceId = positional[2];
  const effectName = positional[3];
  if (!resourceId || !effectName) {
    die("Usage: capcut-david add-effect <project> <resource-id> <name> (<start> <duration> | --full)");
  }
  const { start, duration } = resolveRange(
    draft,
    positional,
    flags,
    "Usage: capcut-david add-effect <project> <resource-id> <name> (<start> <duration> | --full)",
  );
  let effectValue: number | undefined;
  if (flags.value !== undefined) {
    effectValue = parseFloat(flags.value);
    if (Number.isNaN(effectValue) || effectValue < 0 || effectValue > 1) {
      die("--value must be a number in range [0, 1]");
    }
  }
  const opts: AddEffectOptions = {
    resourceId,
    name: effectName,
    start,
    duration,
    value: effectValue,
    bindSegmentId: flags.bind,
  };
  const result = addEffect(draft, filePath, opts);
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      resource_id: resourceId,
      name: effectName,
      value: effectValue ?? 1.0,
      apply_target_type: opts.bindSegmentId ? 0 : 2,
      bind_segment_id: opts.bindSegmentId ?? "",
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

export function cmdAddFilter(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const resourceId = positional[2];
  const filterName = positional[3];
  if (!resourceId || !filterName) {
    die("Usage: capcut-david add-filter <project> <resource-id> <name> (<start> <duration> | --full)");
  }
  const { start, duration } = resolveRange(
    draft,
    positional,
    flags,
    "Usage: capcut-david add-filter <project> <resource-id> <name> (<start> <duration> | --full)",
  );
  let filterValue: number | undefined;
  if (flags.value !== undefined) {
    filterValue = parseFloat(flags.value);
    if (Number.isNaN(filterValue) || filterValue < 0 || filterValue > 1) {
      die("--value must be a number in range [0, 1]");
    }
  }
  const result = addFilter(draft, filePath, {
    resourceId,
    name: filterName,
    start,
    duration,
    value: filterValue,
  });
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      resource_id: resourceId,
      name: filterName,
      value: filterValue ?? 1.0,
      apply_target_type: 0,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}

export function cmdAddTransition(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const segmentId = positional[2];
  const resourceId = positional[3];
  const transitionName = positional[4];
  if (!segmentId || !resourceId || !transitionName) {
    die("Usage: capcut-david add-transition <project> <segment-id> <resource-id> <name> [--duration <t>]");
  }
  let duration: number | undefined;
  if (flags.duration !== undefined) {
    duration = parseTimeInput(flags.duration);
    if (Number.isNaN(duration) || duration <= 0) die("--duration must be a positive time (e.g. 0.2s)");
  }
  const result = addTransition(draft, filePath, {
    segmentId,
    resourceId,
    name: transitionName,
    duration,
  });
  saveDraft(filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      resource_id: resourceId,
      name: transitionName,
      duration_us: duration ?? 400_000,
    },
    flags,
  );
}
