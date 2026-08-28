import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { type Draft, findSegment, type Segment, saveDraft, type Timerange, type Track } from "../draft.js";
import { defaultProjectsRoot, resolveTemplateDir } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { baseSegment, createCompanionMaterials, hexToRgb, registerCompanions, uuid } from "../utils/companion.js";
import { draftPlaceholderToken } from "../utils/draft-token.js";
import { parseTimeInput } from "../utils/time.js";

// --- Init (create new empty draft) ---

export interface InitOptions {
  name: string;
  templateDir: string;
  draftsDir: string;
  width?: number;
  height?: number;
}

export function initDraft(opts: InitOptions): { draftPath: string; filePath: string } {
  const draftPath = resolve(opts.draftsDir, opts.name);
  if (existsSync(draftPath)) {
    throw new Error(`Draft already exists: ${draftPath}. Delete it first or use a different name.`);
  }
  cpSync(opts.templateDir, draftPath, { recursive: true });

  const candidates = ["draft_info.json", "draft_content.json"];
  for (const c of candidates) {
    const fp = resolve(draftPath, c);
    if (existsSync(fp)) {
      const raw = readFileSync(fp, "utf-8");
      const draft = JSON.parse(raw) as Draft;
      draft.name = opts.name;
      draft.id = uuid();
      if (opts.width !== undefined && opts.height !== undefined) {
        draft.canvas_config = { ...draft.canvas_config, width: opts.width, height: opts.height };
      }
      writeFileSync(fp, JSON.stringify(draft, null, 0), "utf-8");
      return { draftPath, filePath: fp };
    }
  }
  throw new Error(`No draft_info.json or draft_content.json found in template: ${opts.templateDir}`);
}

// --- Text ---

export interface TextHighlight {
  /** [start, end) in UTF-16 code units over the caption text. */
  range: [number, number];
  /** RGB in 0..1; fround()ed to float32 internally to match CapCut. */
  color: [number, number, number];
  /** Optional font size (points) for this span; overrides the base/cloned size. */
  size?: number;
}

export interface AddTextOptions {
  text: string;
  start: number;
  duration: number;
  fontSize?: number;
  color?: string;
  alignment?: number;
  x?: number;
  y?: number;
  trackName?: string;
  /** Keyword-highlight spans. When present, emits CapCut rich-text (multi-span). */
  highlights?: TextHighlight[];
}

function buildTextContent(text: string, fontSize: number, color: [number, number, number]): string {
  const encoded = Buffer.from(text, "utf16le");
  return JSON.stringify({
    styles: [
      {
        range: [0, encoded.length],
        size: fontSize,
        bold: false,
        italic: false,
        underline: false,
        fill: {
          alpha: 1,
          content: {
            render_type: "solid",
            solid: { alpha: 1, color },
          },
        },
      },
    ],
    text,
  });
}

/**
 * CapCut rich-text content: N contiguous, non-overlapping style spans covering
 * [0, text.length] in UTF-16 code units. Gaps use `baseColor`; each highlight
 * uses its own color. Colors are fround()ed to float32 to match CapCut's native
 * encoding. Functional/patcher shape: solid fill, no `alpha`, no `useLetterColor`.
 * (`buildTextContent` is left frozen for the single-span path → byte-identity.)
 */
export function buildRichTextContent(
  text: string,
  fontSize: number,
  baseColor: [number, number, number],
  highlights: TextHighlight[],
  baseStyle?: Record<string, unknown>,
): string {
  const n = text.length; // JS string length == UTF-16 code units
  const f = Math.fround;
  const sorted = [...highlights].sort((a, b) => a.range[0] - b.range[0]);
  let prevEnd = 0;
  for (const h of sorted) {
    const [s, e] = h.range;
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > n || s >= e) {
      die(`Invalid highlight range [${s}, ${e}] for text of length ${n}`);
    }
    if (s < prevEnd) die(`Overlapping highlight ranges near [${s}, ${e}]`);
    prevEnd = e;
  }
  const solidFill = (color: [number, number, number]) => ({
    content: { render_type: "solid", solid: { color: [f(color[0]), f(color[1]), f(color[2])] } },
  });
  // baseStyle = a cloned style block from an existing caption (font/strokes/shadows/size/bold…):
  // each span photocopies it and overrides only range + fill (CapCut keyword-highlight encoding)
  // — plus size, but ONLY when the highlight explicitly carries one (byte-identity otherwise).
  // Without baseStyle, the lean default span shape (frozen for byte-identity tests) is used.
  const span = (a: number, b: number, color: [number, number, number], size?: number): Record<string, unknown> =>
    baseStyle
      ? {
          ...JSON.parse(JSON.stringify(baseStyle)),
          range: [a, b],
          fill: solidFill(color),
          ...(size !== undefined ? { size } : {}),
        }
      : { fill: solidFill(color), size: size ?? fontSize, range: [a, b] };
  const styles: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (const h of sorted) {
    const [s, e] = h.range;
    if (s > cursor) styles.push(span(cursor, s, baseColor));
    styles.push(span(s, e, h.color, h.size));
    cursor = e;
  }
  if (cursor < n) styles.push(span(cursor, n, baseColor));
  if (styles.length === 0) styles.push(span(0, n, baseColor));
  return JSON.stringify({ text, styles });
}

/**
 * Build a CapCut text material object. Shared by add-text and import-captions so
 * both paths emit byte-identical fields. When `highlights` is empty the content
 * is the frozen single-span `buildTextContent` (v1.3.0 byte-identity); otherwise
 * it is multi-span rich-text + `is_rich_text`.
 */
export function buildTextMaterial(
  matId: string,
  text: string,
  fontSize: number,
  baseRgb: [number, number, number],
  colorHex: string,
  alignment: number,
  highlights: TextHighlight[],
): Record<string, unknown> {
  const content =
    highlights.length > 0
      ? buildRichTextContent(text, fontSize, baseRgb, highlights)
      : buildTextContent(text, fontSize, baseRgb);
  const mat: Record<string, unknown> = {
    id: matId,
    type: "text",
    content,
    alignment,
    font_size: fontSize,
    text_color: colorHex,
    typesetting: 0,
    letter_spacing: 0,
    line_spacing: 0.02,
    line_feed: 1,
    line_max_width: 0.82,
    force_apply_line_max_width: false,
    check_flag: 7,
    fixed_width: -1,
    fixed_height: -1,
  };
  if (highlights.length > 0) mat.is_rich_text = true;
  return mat;
}

/**
 * Font-agnostic --clone-style resolver: photocopies the style block (font/strokes/shadows/
 * size) off an existing caption segment's material. Falls back to undefined (with a warning
 * on stderr) if the segment is missing or its content can't be parsed — never errors, callers
 * fall back to their own default style. Shared by import-captions and cascade-words.
 */
export function resolveCloneStyle(
  texts: Array<Record<string, unknown>>,
  segment: Segment | undefined,
  label: string,
  commandLabel: string,
): { styleBlock: Record<string, unknown>; material: Record<string, unknown> } | undefined {
  const tplMat = segment ? texts.find((m) => m.id === segment.material_id) : undefined;
  if (tplMat && typeof tplMat.content === "string") {
    try {
      const parsed = JSON.parse(tplMat.content);
      if (Array.isArray(parsed.styles) && parsed.styles[0]) {
        return { styleBlock: parsed.styles[0] as Record<string, unknown>, material: tplMat };
      }
    } catch {
      /* unparseable content → fall through to the warning + default style */
    }
  }
  process.stderr.write(`[${commandLabel}] --clone-style: no styled caption found on ${label}; using default style\n`);
  return undefined;
}

export function addText(
  draft: Draft,
  _filePath: string,
  opts: AddTextOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const segId = uuid();
  const matId = uuid();
  const fontSize = opts.fontSize ?? 15;
  const color = opts.color ?? "#FFFFFF";
  const rgb = hexToRgb(color);
  const alignment = opts.alignment ?? 1;
  const trackName = opts.trackName ?? "text";

  let track = draft.tracks.find((t) => t.type === "text" && (t.name === trackName || !opts.trackName));
  if (!track) {
    track = {
      id: uuid(),
      type: "text",
      name: trackName,
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const companions = createCompanionMaterials("text");
  registerCompanions(draft, companions);

  const highlights = opts.highlights ?? [];
  const textMaterial = buildTextMaterial(matId, opts.text, fontSize, rgb, color, alignment, highlights);
  (draft.materials.texts as unknown as Array<Record<string, unknown>>).push(textMaterial);

  const timerange: Timerange = { start: opts.start, duration: opts.duration };
  const seg = baseSegment(segId, matId, track.id, timerange, companions.ids, 15000);
  if (opts.x !== undefined || opts.y !== undefined) {
    (seg.clip as NonNullable<typeof seg.clip>).transform = { x: opts.x ?? 0, y: opts.y ?? 0 };
  }
  track.segments.push(seg);

  return { segmentId: segId, materialId: matId, trackId: track.id };
}

// --- Audio ---

export interface AddAudioOptions {
  path: string;
  start: number;
  duration: number;
  volume?: number;
  trackName?: string;
}

export function addAudio(
  draft: Draft,
  filePath: string,
  opts: AddAudioOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const segId = uuid();
  const matId = uuid();
  const trackName = opts.trackName ?? "audio";
  const volume = opts.volume ?? 1.0;

  const draftDir = dirname(filePath);
  const filename = basename(opts.path) || "audio.mp3";
  // Copy into <draft>/Resources/<matId>.<ext> and reference it through the
  // portable placeholder token — the cutcli-proven form that survives CapCut
  // duplicating/renaming the draft folder (an absolute path containing the
  // draft name dies on rename → "Link media" dialog).
  const ext = extname(opts.path) || ".mp3";
  const resDir = resolve(draftDir, "Resources");
  mkdirSync(resDir, { recursive: true });
  const destPath = resolve(resDir, `${matId}${ext}`);
  if (!existsSync(destPath)) {
    copyFileSync(resolve(opts.path), destPath);
  }
  const localPath = `${draftPlaceholderToken(draft)}\\Resources\\${matId}${ext}`;

  let track = draft.tracks.find((t) => t.type === "audio" && t.name === trackName);
  if (!track) {
    track = {
      id: uuid(),
      type: "audio",
      name: trackName,
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const companions = createCompanionMaterials("audio");
  registerCompanions(draft, companions);

  const audioMaterial = {
    id: matId,
    path: localPath,
    name: filename,
    duration: opts.duration,
    type: "extract_music",
    category_id: "",
    category_name: "local",
    check_flag: 1,
    music_id: "",
    request_id: "",
    source_platform: 0,
    team_id: "",
    text_id: "",
    tone_category_id: "",
    tone_category_name: "",
    tone_effect_id: "",
    tone_effect_name: "",
    tone_platform: "",
    tone_second_category_id: "",
    tone_second_category_name: "",
    tone_speaker: "",
    tone_type: "",
    wave_points: [],
  };
  (draft.materials.audios as unknown as Array<Record<string, unknown>>).push(audioMaterial);

  const timerange: Timerange = { start: opts.start, duration: opts.duration };
  const seg = baseSegment(segId, matId, track.id, timerange, companions.ids, 11000);
  seg.volume = volume;
  track.segments.push(seg);

  const segEnd = opts.start + opts.duration;
  if (segEnd > draft.duration) {
    draft.duration = segEnd;
  }

  return { segmentId: segId, materialId: matId, trackId: track.id };
}

// --- Video / Image ---

export interface AddVideoOptions {
  path: string;
  start: number;
  duration: number;
  type?: "video" | "photo";
  width?: number;
  height?: number;
  trackName?: string;
  volume?: number;
}

export function addVideo(
  draft: Draft,
  filePath: string,
  opts: AddVideoOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const segId = uuid();
  const matId = uuid();
  const trackName = opts.trackName ?? "video";
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;

  const ext = opts.path.split(".").pop()?.toLowerCase() || "";
  const materialType = opts.type ?? (["jpg", "jpeg", "png", "webp", "bmp", "tiff"].includes(ext) ? "photo" : "video");

  const draftDir = dirname(filePath);
  const filename = basename(opts.path) || "media";
  // Same portable-token form as addAudio — rename-safe (see comment there).
  const fileExt = extname(opts.path);
  const resDir = resolve(draftDir, "Resources");
  mkdirSync(resDir, { recursive: true });
  const destPath = resolve(resDir, `${matId}${fileExt}`);
  if (!existsSync(destPath)) {
    copyFileSync(resolve(opts.path), destPath);
  }
  const localPath = `${draftPlaceholderToken(draft)}\\Resources\\${matId}${fileExt}`;

  let track = draft.tracks.find((t) => t.type === "video" && t.name === trackName);
  if (!track) {
    track = {
      id: uuid(),
      type: "video",
      name: trackName,
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const companions = createCompanionMaterials("video");
  registerCompanions(draft, companions);

  const videoMaterial = {
    id: matId,
    path: localPath,
    material_name: filename,
    type: materialType,
    duration: opts.duration,
    width,
    height,
    category_id: "",
    category_name: "local",
    check_flag: 7,
    crop: {
      lower_left_x: 0,
      lower_left_y: 1,
      lower_right_x: 1,
      lower_right_y: 1,
      upper_left_x: 0,
      upper_left_y: 0,
      upper_right_x: 1,
      upper_right_y: 0,
    },
    has_audio: materialType === "video",
    extra_type_option: 0,
    formula_id: "",
    freeze: null,
    intensifies_audio_path: "",
    intensifies_path: "",
    is_ai_generate_content: false,
    is_copyright: false,
    is_text_edit_overdub: false,
    is_unified_beauty_mode: false,
    local_id: "",
    local_material_id: "",
    material_url: "",
    media_path: "",
    object_locked: null,
    origin_material_id: "",
    request_id: "",
    reverse_path: "",
    source_platform: 0,
    stable: { matrix_path: "", stable_level: 0, time_range: { duration: 0, start: 0 } },
    team_id: "",
    video_algorithm: {
      algorithms: [],
      deflicker: null,
      motion_blur_config: null,
      noise_reduction: null,
      path: "",
      quality_enhance: null,
      time_range: null,
    },
  };
  (draft.materials.videos as unknown as Array<Record<string, unknown>>).push(videoMaterial);

  const timerange: Timerange = { start: opts.start, duration: opts.duration };
  const seg = baseSegment(segId, matId, track.id, timerange, companions.ids, 14000);
  seg.volume = opts.volume ?? 1.0;
  track.segments.push(seg);

  const segEnd = opts.start + opts.duration;
  if (segEnd > draft.duration) {
    draft.duration = segEnd;
  }

  return { segmentId: segId, materialId: matId, trackId: track.id };
}

// --- Video Effect (FX) ---

export interface AddEffectOptions {
  resourceId: string;
  name: string;
  start: number;
  duration: number;
  value?: number;
  bindSegmentId?: string;
}

export function addEffect(
  draft: Draft,
  _filePath: string,
  opts: AddEffectOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const segId = uuid();
  const matId = uuid();
  const value = opts.value ?? 1.0;
  const applyTargetType = opts.bindSegmentId ? 0 : 2;

  let track = draft.tracks.find((t) => t.type === "effect");
  if (!track) {
    track = {
      id: uuid(),
      type: "effect",
      name: "",
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const videoEffect: Record<string, unknown> = {
    id: matId,
    effect_id: opts.resourceId,
    resource_id: opts.resourceId,
    name: opts.name,
    type: "video_effect",
    sub_type: 0,
    bind_segment_id: opts.bindSegmentId ?? "",
    transparent_params: "",
    path: "",
    value,
    category_id: "1111",
    category_name: "Video effects",
    platform: "all",
    apply_target_type: applyTargetType,
    source_platform: 1,
    version: "",
    item_effect_type: 0,
    adjust_params: [],
    time_range: null,
    formula_id: "",
    apply_time_range: null,
    render_index: 0,
    track_render_index: 0,
    common_keyframes: [],
    request_id: "",
    algorithm_artifact_path: "",
    disable_effect_faces: [],
    covering_relation_change: 0,
    enable_mask: true,
    effect_mask: [],
    enable_video_mask_stroke: true,
    enable_video_mask_shadow: true,
  };
  (draft.materials.video_effects as unknown as Array<Record<string, unknown>>).push(videoEffect);

  const timerange: Timerange = { start: opts.start, duration: opts.duration };
  const seg = {
    id: segId,
    material_id: matId,
    source_timerange: null,
    target_timerange: timerange,
    render_timerange: { start: 0, duration: 0 },
    desc: "",
    state: 0,
    speed: 1,
    volume: 1,
    last_nonzero_volume: 1,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    clip: null,
    uniform_scale: null,
    extra_material_refs: [],
    render_index: 11000,
    track_render_index: 0,
    keyframe_refs: [],
    enable_lut: false,
    enable_adjust: false,
    enable_hsl: false,
    visible: true,
    group_id: "",
  } as unknown as Segment;
  track.segments.push(seg);

  return { segmentId: segId, materialId: matId, trackId: track.id };
}

export interface AddFilterOptions {
  resourceId: string;
  name: string;
  start: number;
  duration: number;
  value?: number;
}

// Filters are a different CapCut family than video effects: the material lives
// in materials.effects with type "filter" (shared with query's catalogue scan)
// and the segment sits on a dedicated "filter" track at render_index 10000.
// Shape mirrors what CapCut itself writes when a filter is applied in the UI.
export function addFilter(
  draft: Draft,
  _filePath: string,
  opts: AddFilterOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const segId = uuid();
  const matId = uuid();
  const value = opts.value ?? 1.0;

  let track = draft.tracks.find((t) => t.type === "filter");
  if (!track) {
    track = {
      id: uuid(),
      type: "filter",
      name: "",
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const filterMat: Record<string, unknown> = {
    id: matId,
    effect_id: opts.resourceId,
    resource_id: opts.resourceId,
    third_resource_id: opts.resourceId,
    name: opts.name,
    report_name: "",
    type: "filter",
    sub_type: "none",
    path: "",
    value,
    visible: true,
    item_effect_type: 0,
    category_id: "123456",
    category_name: "Filters",
    category_key: "",
    sub_category_id: "",
    sub_category_name: "",
    platform: "all",
    apply_target_type: 0,
    source_platform: 1,
    version: "",
    adjust_params: [],
    time_range: null,
    formula_id: "",
    enable_skin_tone_correction: false,
    algorithm_artifact_path: "",
    intensity_key: "",
    face_adjust_params: [],
    exclusion_group: [],
    panel_id: "",
    bloom_params: null,
    request_id: "",
    color_match_info: {
      target_feature_path: "",
      source_feature_path: "",
      target_image_path: "",
    },
    multi_language_current: "",
    lumi_hub_path: "",
    covering_relation_change: 0,
    smart_color_mode: 0,
    is_from_intelligent_quality: false,
  };
  const mats = draft.materials as unknown as Record<string, unknown>;
  if (!Array.isArray(mats.effects)) mats.effects = [];
  (mats.effects as Array<Record<string, unknown>>).push(filterMat);

  const timerange: Timerange = { start: opts.start, duration: opts.duration };
  const seg = {
    id: segId,
    material_id: matId,
    source_timerange: null,
    target_timerange: timerange,
    render_timerange: { start: 0, duration: 0 },
    desc: "",
    state: 0,
    speed: 1,
    volume: 1,
    last_nonzero_volume: 1,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    clip: null,
    uniform_scale: null,
    extra_material_refs: [],
    render_index: 10000,
    track_render_index: 0,
    keyframe_refs: [],
    enable_lut: false,
    enable_adjust: false,
    enable_hsl: false,
    visible: true,
    group_id: "",
  } as unknown as Segment;
  track.segments.push(seg);

  return { segmentId: segId, materialId: matId, trackId: track.id };
}

export interface AddTransitionOptions {
  segmentId: string;
  resourceId: string;
  name: string;
  duration?: number; // µs — CapCut default 0.4s
}

// Transitions have no dedicated track: the material lives in
// materials.transitions and its id is appended to the extra_material_refs of
// the segment BEFORE the transition (transition to the next segment). Shape
// mirrors what CapCut writes when a transition is applied in the UI (witness:
// "Black Fade" in psycho_lavoixdapres_v1_schemav1, machine-specific
// path/request_id blanked like add-filter does).
export function addTransition(
  draft: Draft,
  _filePath: string,
  opts: AddTransitionOptions,
): { segmentId: string; materialId: string; trackId: string } {
  const hit = findSegment(draft, opts.segmentId);
  if (!hit) die(`Segment not found: ${opts.segmentId}`);
  const { track, segment } = hit;
  if (track.type !== "video") {
    die(`add-transition requires a video segment; "${segment.id}" is on a "${track.type}" track`);
  }

  const matId = uuid();
  const transitionMat: Record<string, unknown> = {
    id: matId,
    type: "transition",
    name: opts.name,
    effect_id: opts.resourceId,
    resource_id: opts.resourceId,
    third_resource_id: opts.resourceId,
    source_platform: 1,
    path: "",
    duration: opts.duration ?? 400_000,
    is_overlap: false,
    platform: "all",
    category_id: "123456",
    category_name: "Transitions",
    request_id: "",
    is_ai_transition: false,
    video_path: "",
    task_id: "",
  };
  const mats = draft.materials as unknown as Record<string, unknown>;
  if (!Array.isArray(mats.transitions)) mats.transitions = [];
  (mats.transitions as Array<Record<string, unknown>>).push(transitionMat);

  segment.extra_material_refs.push(matId);

  return { segmentId: segment.id, materialId: matId, trackId: track.id };
}

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

/** Default keyword-highlight color (gold-yellow [1.0, 0.84, 0.0]). */
export const DEFAULT_HIGHLIGHT_COLOR = "#FFD600";

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

// --- Import captions (batch, replaces a text track) ---

export interface CaptionCard {
  text: string;
  start: number; // microseconds
  end: number; // microseconds
  /** Optional keyword highlight range [start, end) in UTF-16 code units. */
  hl?: [number, number];
  /** Optional per-card highlight color (hex); falls back to opts.highlightColor. */
  color?: string;
  /** Optional per-card highlight font size (points); falls back to opts.highlightSize. */
  hlSize?: number;
}

export interface ImportCaptionsOptions {
  cards: CaptionCard[];
  trackName?: string;
  highlightColor?: string;
  /** Default highlight font size (points) for cards without hlSize. */
  highlightSize?: number;
  fontSize?: number;
  color?: string;
  /** Per-card base color cycle: card i uses colorCycle[i % colorCycle.length], overriding `color`. */
  colorCycle?: string[];
  alignment?: number;
  /** clip.transform.y for every rebuilt segment (global; negatives allowed). */
  transformY?: number;
  /** Clone the style (font/strokes/shadows/size) of the target track's first caption. */
  cloneStyle?: boolean;
}

/**
 * Batch-build word/keyword captions and REPLACE the named text track's segments
 * (1:1 with the inject_word_captions.py patcher). Old text materials are left
 * orphaned (unreferenced => invisible => zero deletion risk). Per-card `hl`
 * drives the highlight; `color` overrides the global highlight color.
 */
export function importCaptions(
  draft: Draft,
  _filePath: string,
  opts: ImportCaptionsOptions,
): { trackId: string; count: number } {
  const fontSize = opts.fontSize ?? 15;
  const baseHex = opts.color ?? "#FFFFFF";
  const baseRgb = hexToRgb(baseHex);
  const defaultHl = opts.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const alignment = opts.alignment ?? 1;

  // Target track: an explicit --track-name matches by name; otherwise the FIRST text
  // track (CapCut caption tracks are usually unnamed — patcher parity, no name to hunt).
  const trackLabel = opts.trackName ?? "(first text track)";
  let track =
    opts.trackName !== undefined
      ? draft.tracks.find((t) => t.type === "text" && t.name === opts.trackName)
      : draft.tracks.find((t) => t.type === "text");
  if (!track) {
    track = {
      id: uuid(),
      type: "text",
      name: opts.trackName ?? "text",
      attribute: 0,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const texts = draft.materials.texts as unknown as Array<Record<string, unknown>>;

  // --clone-style: photocopy the existing caption look (font/strokes/shadows/size) from
  // the target track's first segment BEFORE it is replaced.
  const cloneTpl = opts.cloneStyle
    ? resolveCloneStyle(texts, track.segments[0], trackLabel, "import-captions")
    : undefined;

  const newSegs: Segment[] = [];
  opts.cards.forEach((card, i) => {
    if (typeof card.text !== "string") die(`captions[${i}]: missing string field "text"`);
    if (!Number.isFinite(card.start) || !Number.isFinite(card.end)) {
      die(`captions[${i}]: "start" and "end" must be numbers (microseconds)`);
    }
    // Same contract as the --keyword-size/--highlight-size flags: a present hlSize must be a
    // finite number > 0 (a typo here would otherwise be written verbatim into the draft).
    if (card.hlSize !== undefined && (!Number.isFinite(card.hlSize) || card.hlSize <= 0)) {
      die(
        `captions[${i}]: "hlSize" must be a positive number (font size in points), got ${JSON.stringify(card.hlSize)}`,
      );
    }
    const matId = uuid();
    const segId = uuid();
    const cardHex =
      opts.colorCycle && opts.colorCycle.length > 0 ? opts.colorCycle[i % opts.colorCycle.length] : baseHex;
    const cardRgb = cardHex === baseHex ? baseRgb : hexToRgb(cardHex);
    const hl = card.hl;
    // Batch tolerance (1:1 with the patcher): a degenerate/sentinel range (e.g. [0,0]
    // or any e <= s) means "no highlight on this card" — NOT an error, unlike the strict
    // add-text --keyword-range path. Valid ranges are still bounds-checked in buildRichTextContent.
    const hasHl = Array.isArray(hl) && hl.length === 2 && hl[1] > hl[0];
    const highlights: TextHighlight[] = hasHl
      ? [{ range: [hl[0], hl[1]], color: hexToRgb(card.color ?? defaultHl), size: card.hlSize ?? opts.highlightSize }]
      : [];
    if (cloneTpl) {
      // Clone mode: deepcopy the template material (keeps font_size/text_color/border_*/shadow_*/
      // line_spacing…), then rebuild content with the cloned per-span style block. Every card
      // becomes rich-text (patcher parity) so the user's look survives on all spans.
      const mat = JSON.parse(JSON.stringify(cloneTpl.material)) as Record<string, unknown>;
      mat.id = matId;
      mat.content = buildRichTextContent(card.text, fontSize, cardRgb, highlights, cloneTpl.styleBlock);
      mat.base_content = card.text;
      if ("recognize_text" in mat) mat.recognize_text = card.text;
      mat.is_rich_text = true;
      texts.push(mat);
    } else {
      texts.push(buildTextMaterial(matId, card.text, fontSize, cardRgb, cardHex, alignment, highlights));
    }
    const companions = createCompanionMaterials("text");
    registerCompanions(draft, companions);
    const duration = Math.max(1, card.end - card.start);
    const seg = baseSegment(segId, matId, track.id, { start: card.start, duration }, companions.ids, 15000);
    if (opts.transformY !== undefined && seg.clip) seg.clip.transform.y = opts.transformY;
    newSegs.push(seg);
  });

  track.segments = newSegs;
  // Captions define the timeline length when no other media does — extend duration.
  const maxEnd = opts.cards.reduce((m, c) => Math.max(m, c.end), 0);
  if (maxEnd > (draft.duration ?? 0)) draft.duration = maxEnd;
  return { trackId: track.id, count: newSegs.length };
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
