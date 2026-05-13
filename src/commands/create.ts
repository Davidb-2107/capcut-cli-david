import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Draft, type Segment, saveDraft, type Timerange, type Track } from "../draft.js";
import { defaultProjectsRoot, resolveTemplateDir } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { baseSegment, createCompanionMaterials, hexToRgb, registerCompanions, uuid } from "../utils/companion.js";
import { parseTimeInput } from "../utils/time.js";

// --- Init (create new empty draft) ---

export interface InitOptions {
  name: string;
  templateDir: string;
  draftsDir: string;
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
      writeFileSync(fp, JSON.stringify(draft, null, 0), "utf-8");
      return { draftPath, filePath: fp };
    }
  }
  throw new Error(`No draft_info.json or draft_content.json found in template: ${opts.templateDir}`);
}

// --- Text ---

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

  const textMaterial = {
    id: matId,
    type: "text",
    content: buildTextContent(opts.text, fontSize, rgb),
    alignment,
    font_size: fontSize,
    text_color: color,
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
  const filename = opts.path.split("/").pop() || "audio.mp3";
  const assetsDir = resolve(draftDir, "assets", "audio");
  mkdirSync(assetsDir, { recursive: true });
  const destPath = resolve(assetsDir, filename);
  if (!existsSync(destPath)) {
    copyFileSync(opts.path, destPath);
  }
  const localPath = destPath;

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
  const filename = opts.path.split("/").pop() || "media";
  const assetsDir = resolve(draftDir, "assets", "video");
  mkdirSync(assetsDir, { recursive: true });
  const destPath = resolve(assetsDir, filename);
  if (!existsSync(destPath)) {
    copyFileSync(opts.path, destPath);
  }
  const localPath = destPath;

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
  const result = initDraft({ name, templateDir, draftsDir });
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
  const absPath = audioPath.startsWith("/") ? audioPath : `${process.cwd()}/${audioPath}`;
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
  const absPath = videoPath.startsWith("/") ? videoPath : `${process.cwd()}/${videoPath}`;
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

export function cmdAddEffect(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const resourceId = positional[2];
  const effectName = positional[3];
  const startStr = positional[4];
  const durationStr = positional[5];
  if (!resourceId || !effectName || !startStr || !durationStr) {
    die("Usage: capcut-david add-effect <project> <resource-id> <name> <start> <duration>");
  }
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
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
