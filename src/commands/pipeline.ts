import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { loadDraft, saveDraft } from "../draft.js";
import { resolveTemplateDir as resolveSharedTemplateDir } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { setUuidProvider } from "../utils/companion.js";
import { buildDraftMetaInfo } from "../utils/draft-meta.js";
import { secondsToUs } from "../utils/time.js";
import { addAudio, addText, addVideo, initDraft } from "./create.js";
import { cmdKenBurns } from "./keyframe.js";
import { registerDraft } from "./register.js";

// =============================================================
// YAML (subset) parser
// Supports: block mappings, block sequences, flow mappings/sequences,
// scalars (string/number/bool/null), quoted strings, comments. Tracks line
// numbers for error reporting. Not a complete YAML 1.2 parser — only the
// shape this CLI's manifest schema needs.
// =============================================================

export type YamlNode = string | number | boolean | null | YamlNode[] | { [k: string]: YamlNode };

export class YamlError extends Error {
  constructor(
    msg: string,
    public line: number,
  ) {
    super(`YAML line ${line}: ${msg}`);
    this.name = "YamlError";
  }
}

interface Tok {
  line: number;
  indent: number;
  content: string;
}

function tokenize(src: string): Tok[] {
  const rawLines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Tok[] = [];
  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    // Strip trailing comment, respecting quoted strings
    let inStr: string | null = null;
    let end = raw.length;
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j];
      if (inStr) {
        if (c === "\\" && inStr === '"') {
          j++;
          continue;
        }
        if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c;
      } else if (c === "#" && (j === 0 || /\s/.test(raw[j - 1]))) {
        end = j;
        break;
      }
    }
    const line = raw.slice(0, end).replace(/\s+$/, "");
    if (line === "") continue;
    const m = line.match(/^( *)(.*)$/) as RegExpMatchArray;
    const indent = m[1].length;
    const content = m[2];
    // Normalize "- key: value" → emit "-" then "key: value" at indent+2 so the
    // recursive parser can treat the sequence marker uniformly.
    const dashKv = content.match(/^-\s+(.+)$/);
    if (dashKv) {
      const rest = dashKv[1];
      const isFlow = rest.startsWith("{") || rest.startsWith("[");
      const hasColon = !isFlow && findUnquotedColon(rest) >= 0;
      if (hasColon) {
        out.push({ line: li + 1, indent, content: "-" });
        out.push({ line: li + 1, indent: indent + 2, content: rest });
        continue;
      }
    }
    out.push({ line: li + 1, indent, content });
  }
  return out;
}

function findUnquotedColon(s: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\" && inStr === '"') {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === ":") {
      // colon must be followed by space or end-of-line (YAML key delimiter)
      if (i + 1 === s.length || s[i + 1] === " ") return i;
    }
  }
  return -1;
}

function parseScalar(s: string, _line: number): YamlNode {
  const t = s.trim();
  if (t === "" || t === "null" || t === "~") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    const inner = t.slice(1, -1);
    if (t.startsWith('"')) {
      return inner.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return inner.replace(/''/g, "'");
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(t)) return parseFloat(t);
  return t;
}

function parseFlow(src: string, line: number): YamlNode {
  let i = 0;
  const skipWs = (): void => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const readQuoted = (q: string): string => {
    let buf = "";
    while (i < src.length) {
      const c = src[i++];
      if (c === "\\" && q === '"') {
        const n = src[i++];
        if (n === "n") buf += "\n";
        else if (n === "t") buf += "\t";
        else if (n === '"') buf += '"';
        else if (n === "\\") buf += "\\";
        else buf += n;
        continue;
      }
      if (c === q) return buf;
      buf += c;
    }
    throw new YamlError("Unterminated quoted string in flow", line);
  };
  const readValue = (): YamlNode => {
    skipWs();
    if (i >= src.length) throw new YamlError("Unexpected end of flow value", line);
    const c = src[i];
    if (c === "{") return readMap();
    if (c === "[") return readSeq();
    if (c === '"' || c === "'") {
      i++;
      const raw = readQuoted(c);
      return c === '"' ? raw : raw.replace(/''/g, "'");
    }
    let end = i;
    while (end < src.length && src[end] !== "," && src[end] !== "}" && src[end] !== "]") end++;
    const raw = src.slice(i, end);
    i = end;
    return parseScalar(raw, line);
  };
  const readMap = (): { [k: string]: YamlNode } => {
    if (src[i] !== "{") throw new YamlError("Expected '{'", line);
    i++;
    const obj: { [k: string]: YamlNode } = {};
    skipWs();
    if (src[i] === "}") {
      i++;
      return obj;
    }
    while (i < src.length) {
      skipWs();
      let key: string;
      if (src[i] === '"' || src[i] === "'") {
        const q = src[i++];
        key = readQuoted(q);
        if (q === "'") key = key.replace(/''/g, "'");
      } else {
        const kStart = i;
        while (i < src.length && src[i] !== ":" && src[i] !== "," && src[i] !== "}") i++;
        key = src.slice(kStart, i).trim();
      }
      skipWs();
      if (src[i] !== ":") throw new YamlError(`Expected ':' in flow mapping, got '${src[i] ?? "EOF"}'`, line);
      i++;
      obj[key] = readValue();
      skipWs();
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === "}") {
        i++;
        return obj;
      }
      throw new YamlError(`Unexpected '${src[i] ?? "EOF"}' in flow mapping`, line);
    }
    throw new YamlError("Unterminated flow mapping", line);
  };
  const readSeq = (): YamlNode[] => {
    if (src[i] !== "[") throw new YamlError("Expected '['", line);
    i++;
    const arr: YamlNode[] = [];
    skipWs();
    if (src[i] === "]") {
      i++;
      return arr;
    }
    while (i < src.length) {
      arr.push(readValue());
      skipWs();
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === "]") {
        i++;
        return arr;
      }
      throw new YamlError(`Unexpected '${src[i] ?? "EOF"}' in flow sequence`, line);
    }
    throw new YamlError("Unterminated flow sequence", line);
  };
  const v = readValue();
  skipWs();
  if (i !== src.length) throw new YamlError(`Trailing characters in flow: ${src.slice(i)}`, line);
  return v;
}

function parseBlock(toks: Tok[], start: number, parentIndent: number): { value: YamlNode; next: number } {
  if (start >= toks.length) return { value: null, next: start };
  const first = toks[start];
  if (first.indent <= parentIndent) return { value: null, next: start };
  const indent = first.indent;
  if (first.content === "-" || first.content.startsWith("- ")) {
    const arr: YamlNode[] = [];
    let i = start;
    while (
      i < toks.length &&
      toks[i].indent === indent &&
      (toks[i].content === "-" || toks[i].content.startsWith("- "))
    ) {
      const t = toks[i];
      if (t.content === "-") {
        const r = parseBlock(toks, i + 1, indent);
        arr.push(r.value);
        i = r.next;
      } else {
        const rest = t.content.slice(2).trim();
        if (rest.startsWith("{") || rest.startsWith("[")) {
          arr.push(parseFlow(rest, t.line));
          i++;
        } else {
          arr.push(parseScalar(rest, t.line));
          i++;
        }
      }
    }
    return { value: arr, next: i };
  }
  const obj: { [k: string]: YamlNode } = {};
  let i = start;
  while (i < toks.length && toks[i].indent === indent) {
    const t = toks[i];
    if (t.content === "-" || t.content.startsWith("- ")) break;
    const colon = findUnquotedColon(t.content);
    if (colon < 0) throw new YamlError(`Expected 'key: value', got: ${t.content}`, t.line);
    const rawKey = t.content.slice(0, colon).trim();
    const key =
      (rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))
        ? rawKey.slice(1, -1)
        : rawKey;
    const v = t.content.slice(colon + 1).trim();
    if (v === "") {
      const r = parseBlock(toks, i + 1, indent);
      obj[key] = r.value;
      i = r.next;
    } else if (v.startsWith("{") || v.startsWith("[")) {
      obj[key] = parseFlow(v, t.line);
      i++;
    } else {
      obj[key] = parseScalar(v, t.line);
      i++;
    }
  }
  return { value: obj, next: i };
}

export function parseYaml(src: string): YamlNode {
  const toks = tokenize(src);
  if (toks.length === 0) return {};
  const r = parseBlock(toks, 0, -1);
  if (r.next !== toks.length) {
    throw new YamlError(`Unexpected content past root at line ${toks[r.next].line}`, toks[r.next].line);
  }
  return r.value;
}

// =============================================================
// SRT parser
// =============================================================

export interface SrtEntry {
  index: number;
  start_us: number;
  end_us: number;
  text: string;
}

function parseSrtTime(s: string, line: number): number {
  const m = s.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) throw new Error(`SRT line ${line}: invalid timestamp "${s}"`);
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, "0"), 10);
  return secondsToUs(h * 3600 + mn * 60 + sec) + ms * 1000;
}

export function parseSrt(src: string): SrtEntry[] {
  const norm = src.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  if (norm === "") return [];
  const blocks = norm.split(/\n\s*\n/);
  const entries: SrtEntry[] = [];
  let lineCursor = 1;
  for (const block of blocks) {
    const lines = block.split("\n");
    const blockStart = lineCursor;
    lineCursor += lines.length + 1;
    if (lines.length < 2) continue;
    let idx = 0;
    let timingLine = 0;
    if (/^\d+$/.test(lines[0].trim())) {
      idx = parseInt(lines[0].trim(), 10);
      timingLine = 1;
    } else {
      timingLine = 0;
    }
    const timing = lines[timingLine];
    const tm = timing.match(/^([\d:,.]+)\s*-->\s*([\d:,.]+)/);
    if (!tm) throw new Error(`SRT line ${blockStart + timingLine}: missing '-->' timing`);
    const start_us = parseSrtTime(tm[1], blockStart + timingLine);
    const end_us = parseSrtTime(tm[2], blockStart + timingLine);
    const text = lines
      .slice(timingLine + 1)
      .join("\n")
      .trim();
    entries.push({ index: idx || entries.length + 1, start_us, end_us, text });
  }
  return entries;
}

// =============================================================
// Manifest types + validator
// =============================================================

export interface KenBurnsSpec {
  from: number;
  to: number;
  curve?: string;
}

export interface ImageSpec {
  path: string;
  duration: string;
  ken_burns?: KenBurnsSpec;
}

export interface AudioSpec {
  path: string;
  volume?: number;
}

export interface CaptionStyle {
  font_size?: number;
  color?: string;
  align?: number;
}

export interface CaptionsSpec {
  srt: string;
  style?: CaptionStyle;
}

export interface Manifest {
  title: string;
  resolution: { width: number; height: number };
  fps: number;
  seed?: string | number;
  images: ImageSpec[];
  voice?: AudioSpec;
  music?: AudioSpec;
  captions?: CaptionsSpec;
}

function isObj(v: unknown): v is { [k: string]: YamlNode } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function requireString(o: { [k: string]: YamlNode }, key: string, ctx: string): string {
  const v = o[key];
  if (typeof v !== "string" || v === "") die(`${ctx}: missing or empty string field "${key}"`);
  return v as string;
}

function requireNumber(o: { [k: string]: YamlNode }, key: string, ctx: string): number {
  const v = o[key];
  if (typeof v !== "number") die(`${ctx}: missing or non-numeric field "${key}"`);
  return v as number;
}

export function validateManifest(raw: YamlNode): Manifest {
  if (!isObj(raw)) die("Manifest must be a YAML mapping at the top level");
  const title = requireString(raw, "title", "manifest");
  const resRaw = raw.resolution;
  if (!isObj(resRaw)) die('manifest.resolution must be a mapping with "width" and "height"');
  const width = requireNumber(resRaw, "width", "manifest.resolution");
  const height = requireNumber(resRaw, "height", "manifest.resolution");
  if (width <= 0 || height <= 0) die("manifest.resolution width/height must be > 0");
  const fps = typeof raw.fps === "number" ? (raw.fps as number) : 30;
  if (fps <= 0) die("manifest.fps must be > 0");
  let seed: string | number | undefined;
  if (typeof raw.seed === "string" || typeof raw.seed === "number") seed = raw.seed as string | number;

  const imagesRaw = raw.images;
  if (!Array.isArray(imagesRaw) || imagesRaw.length === 0) die("manifest.images must be a non-empty sequence");
  const images: ImageSpec[] = imagesRaw.map((it, idx) => {
    const ctx = `manifest.images[${idx}]`;
    if (!isObj(it)) die(`${ctx}: must be a mapping`);
    const path = requireString(it, "path", ctx);
    const duration = requireString(it, "duration", ctx);
    let ken_burns: KenBurnsSpec | undefined;
    if (it.ken_burns !== undefined && it.ken_burns !== null) {
      const kb = it.ken_burns;
      if (!isObj(kb)) die(`${ctx}.ken_burns must be a mapping`);
      const from = requireNumber(kb, "from", `${ctx}.ken_burns`);
      const to = requireNumber(kb, "to", `${ctx}.ken_burns`);
      const curveRaw = kb.curve;
      const curve = curveRaw === undefined || curveRaw === null ? undefined : String(curveRaw);
      ken_burns = { from, to, curve };
    }
    return { path, duration, ken_burns };
  });

  let voice: AudioSpec | undefined;
  if (raw.voice !== undefined && raw.voice !== null) {
    if (!isObj(raw.voice)) die("manifest.voice must be a mapping");
    voice = {
      path: requireString(raw.voice, "path", "manifest.voice"),
      volume: typeof raw.voice.volume === "number" ? (raw.voice.volume as number) : undefined,
    };
  }
  let music: AudioSpec | undefined;
  if (raw.music !== undefined && raw.music !== null) {
    if (!isObj(raw.music)) die("manifest.music must be a mapping");
    music = {
      path: requireString(raw.music, "path", "manifest.music"),
      volume: typeof raw.music.volume === "number" ? (raw.music.volume as number) : undefined,
    };
  }

  let captions: CaptionsSpec | undefined;
  if (raw.captions !== undefined && raw.captions !== null) {
    if (!isObj(raw.captions)) die("manifest.captions must be a mapping");
    const srt = requireString(raw.captions, "srt", "manifest.captions");
    let style: CaptionStyle | undefined;
    if (raw.captions.style !== undefined && raw.captions.style !== null) {
      if (!isObj(raw.captions.style)) die("manifest.captions.style must be a mapping");
      const s = raw.captions.style;
      style = {
        font_size: typeof s.font_size === "number" ? (s.font_size as number) : undefined,
        color: typeof s.color === "string" ? (s.color as string) : undefined,
        align: typeof s.align === "number" ? (s.align as number) : undefined,
      };
    }
    captions = { srt, style };
  }

  return { title, resolution: { width, height }, fps, seed, images, voice, music, captions };
}

// =============================================================
// Duration string parser
// =============================================================

export function parseDurationToUs(s: string): number {
  const t = s.trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!m) throw new Error(`Invalid duration: "${s}". Expected like "3s", "500ms", "1.5".`);
  const val = parseFloat(m[1]);
  const unit = m[2] ?? "s";
  if (unit === "ms") return Math.round(val * 1000);
  if (unit === "m") return Math.round(val * 60 * 1_000_000);
  return Math.round(val * 1_000_000);
}

// =============================================================
// Seeded UUID generator (RFC 4122 v4 layout, deterministic given seed).
// Uses mulberry32 PRNG over a 32-bit seed derived from the input.
// =============================================================

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeSeededUuid(seed: string | number): () => string {
  let state = hashSeed(seed) || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (n: number, w: number): string => n.toString(16).padStart(w, "0");
  return (): string => {
    const bytes = new Array<number>(16);
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(next() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const b = bytes.map((x) => hex(x, 2)).join("");
    return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20, 32)}`;
  };
}

// =============================================================
// Path / template helpers
// =============================================================

function resolveAsset(p: string, baseDir: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "draft"
  );
}

function resolveTemplateDir(): string {
  // Thin wrapper that surfaces the shared helper's failure as a CliError.
  try {
    return resolveSharedTemplateDir();
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
}

// =============================================================
// CapCut metadata file builders
// CapCut indexes drafts by reading three files per project. We emit them
// alongside draft_content.json so the freshly-built psycho draft is visible
// in the CapCut UI without manual import.
// =============================================================

function buildDraftInfo(opts: { draftId: string; width: number; height: number }): Record<string, unknown> {
  return {
    canvas_config: { height: opts.height, ratio: "original", width: opts.width, background: null },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      voice_change_sync: false,
      zoom_info_params: null,
      use_float_render: false,
    },
    cover: "",
    create_time: 0,
    duration: 0,
    id: opts.draftId,
    new_version: "164.0.0",
    platform: "windows",
    update_time: 0,
    version: 0,
  };
}

// =============================================================
// Orchestrator
// =============================================================

export interface PsychoBuildResult {
  draftPath: string;
  filePath: string;
  metaInfoPath: string;
  draftInfoPath: string;
  total_duration_us: number;
  images: number;
  voice: boolean;
  music: boolean;
  captions: number;
  seeded: boolean;
  registered: boolean;
  registerRootMetaPath?: string;
}

export interface PsychoBuildRegisterOpts {
  register: boolean;
  projectsRoot?: string;
}

export function psychoBuild(
  manifestPath: string,
  outOpt: string | undefined,
  seedOpt: string | undefined,
  registerOpt?: PsychoBuildRegisterOpts,
): PsychoBuildResult {
  if (!existsSync(manifestPath)) die(`Manifest not found: ${manifestPath}`);
  const manifestAbs = resolve(manifestPath);
  const manifestDir = dirname(manifestAbs);
  const raw = readFileSync(manifestAbs, "utf-8");
  const parsed = parseYaml(raw);
  const manifest = validateManifest(parsed);

  const effectiveSeed =
    seedOpt !== undefined ? seedOpt : manifest.seed !== undefined ? String(manifest.seed) : undefined;
  if (effectiveSeed !== undefined) setUuidProvider(makeSeededUuid(effectiveSeed));

  try {
    const slug = slugify(manifest.title);
    const outAbs = outOpt ? resolve(outOpt) : resolve(manifestDir, "build", slug);
    const draftsDir = dirname(outAbs);
    const name = basename(outAbs);
    const templateDir = resolveTemplateDir();

    const { draftPath, filePath } = initDraft({ name, templateDir, draftsDir });
    const { draft } = loadDraft(filePath);
    draft.canvas_config.width = manifest.resolution.width;
    draft.canvas_config.height = manifest.resolution.height;
    draft.fps = manifest.fps;

    const silent: Flags = { human: false, quiet: true };

    let cursor = 0;
    let imageCount = 0;
    for (const img of manifest.images) {
      const assetPath = resolveAsset(img.path, manifestDir);
      if (!existsSync(assetPath))
        die(`Image asset not found: ${assetPath} (declared in manifest.images[${imageCount}])`);
      const dur = parseDurationToUs(img.duration);
      const r = addVideo(draft, filePath, { path: assetPath, start: cursor, duration: dur });
      if (img.ken_burns) {
        cmdKenBurns(
          draft,
          filePath,
          r.segmentId,
          String(img.ken_burns.from),
          String(img.ken_burns.to),
          img.ken_burns.curve,
          silent,
          false,
        );
      }
      cursor += dur;
      imageCount++;
    }

    const totalUs = cursor;

    if (manifest.voice) {
      const voicePath = resolveAsset(manifest.voice.path, manifestDir);
      if (!existsSync(voicePath)) die(`Voice asset not found: ${voicePath}`);
      addAudio(draft, filePath, {
        path: voicePath,
        start: 0,
        duration: totalUs,
        volume: manifest.voice.volume,
        trackName: "voice",
      });
    }

    if (manifest.music) {
      const musicPath = resolveAsset(manifest.music.path, manifestDir);
      if (!existsSync(musicPath)) die(`Music asset not found: ${musicPath}`);
      addAudio(draft, filePath, {
        path: musicPath,
        start: 0,
        duration: totalUs,
        volume: manifest.music.volume,
        trackName: "music",
      });
    }

    let captionCount = 0;
    if (manifest.captions) {
      const srtPath = resolveAsset(manifest.captions.srt, manifestDir);
      if (!existsSync(srtPath)) die(`Captions SRT not found: ${srtPath}`);
      const srtText = readFileSync(srtPath, "utf-8");
      const entries = parseSrt(srtText);
      const style = manifest.captions.style ?? {};
      for (const e of entries) {
        addText(draft, filePath, {
          text: e.text,
          start: e.start_us,
          duration: e.end_us - e.start_us,
          fontSize: style.font_size,
          color: style.color,
          alignment: style.align,
        });
      }
      captionCount = entries.length;
    }

    saveDraft(filePath, draft);

    // Emit CapCut's two sidecar metadata files so the draft is visible in the
    // CapCut UI's project list. draft_content.json alone is not enough.
    const draftFoldPath = draftPath;
    const draftRootPath = dirname(draftPath);
    const metaInfo = buildDraftMetaInfo({
      draftId: draft.id,
      draftName: name,
      draftFoldPath,
      draftRootPath,
      totalDurationUs: totalUs,
    });
    const metaInfoPath = resolve(draftPath, "draft_meta_info.json");
    writeFileSync(metaInfoPath, JSON.stringify(metaInfo, null, 0), "utf-8");

    const draftInfo = buildDraftInfo({
      draftId: draft.id,
      width: manifest.resolution.width,
      height: manifest.resolution.height,
    });
    const draftInfoPath = resolve(draftPath, "draft_info.json");
    writeFileSync(draftInfoPath, JSON.stringify(draftInfo, null, 0), "utf-8");

    let registered = false;
    let registerRootMetaPath: string | undefined;
    if (registerOpt?.register) {
      const reg = registerDraft({ draftDir: draftPath, projectsRoot: registerOpt.projectsRoot });
      registered = true;
      registerRootMetaPath = reg.rootMetaPath;
    }

    return {
      draftPath,
      filePath,
      metaInfoPath,
      draftInfoPath,
      total_duration_us: totalUs,
      images: imageCount,
      voice: !!manifest.voice,
      music: !!manifest.music,
      captions: captionCount,
      seeded: effectiveSeed !== undefined,
      registered,
      registerRootMetaPath,
    };
  } finally {
    setUuidProvider(null);
  }
}

export function cmdPsychoBuild(positional: string[], flags: Flags): void {
  const manifestPath = positional[1];
  if (!manifestPath)
    die(
      "Usage: capcut-david psycho-build <manifest.yaml> [--out <dir>] [--seed <n>] [--register] [--projects-root <dir>]",
    );
  const registerOpt: PsychoBuildRegisterOpts | undefined = flags.register
    ? { register: true, projectsRoot: flags.projectsRoot }
    : undefined;
  const result = psychoBuild(manifestPath, flags.out, flags.seed, registerOpt);
  out(
    {
      ok: true,
      draft_path: result.draftPath,
      file_path: result.filePath,
      meta_info_path: result.metaInfoPath,
      draft_info_path: result.draftInfoPath,
      total_duration_us: result.total_duration_us,
      images: result.images,
      voice: result.voice,
      music: result.music,
      captions: result.captions,
      seeded: result.seeded,
      registered: result.registered,
      register_root_meta_path: result.registerRootMetaPath,
    },
    flags,
  );
}
