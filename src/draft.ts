import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CliError } from "./utils/cli.js";
import { normalizeTimelineIdentity, syncTimelineRootBytes } from "./utils/timelines.js";

export interface Timerange {
  start: number;
  duration: number;
}

export interface Segment {
  id: string;
  material_id: string;
  target_timerange: Timerange;
  source_timerange: Timerange;
  speed: number;
  volume: number;
  visible: boolean;
  clip: {
    alpha: number;
    rotation: number;
    scale: { x: number; y: number };
    transform: { x: number; y: number };
  } | null;
  extra_material_refs: string[];
  render_index: number;
  [key: string]: unknown;
}

export interface Track {
  id: string;
  type: string;
  /** Optional on disk — tracks created by other tools (e.g. cutcli) omit it. */
  name?: string;
  attribute: number;
  segments: Segment[];
}

export interface MaterialText {
  id: string;
  type: string;
  content: string;
  font_size: number;
  text_color: string;
  alignment: number;
  [key: string]: unknown;
}

export interface MaterialVideo {
  id: string;
  path: string;
  material_name: string;
  type: string;
  duration: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface MaterialAudio {
  id: string;
  path: string;
  name: string;
  duration: number;
  type: string;
  [key: string]: unknown;
}

export interface Draft {
  id: string;
  name: string;
  duration: number;
  fps: number;
  canvas_config: {
    width: number;
    height: number;
    ratio: string;
  };
  tracks: Track[];
  materials: {
    videos: MaterialVideo[];
    audios: MaterialAudio[];
    texts: MaterialText[];
    speeds: Array<{ id: string; speed: number; [key: string]: unknown }>;
    material_animations: Array<Record<string, unknown>>;
    audio_fades: Array<Record<string, unknown>>;
    transitions: Array<Record<string, unknown>>;
    [key: string]: Array<Record<string, unknown>>;
  };
  platform?: {
    app_source: string;
    app_version: string;
    os: string;
  };
  [key: string]: unknown;
}

export function findDraft(input: string): string {
  const resolved = resolve(input);
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  const candidates = [resolve(resolved, "draft_content.json"), resolve(resolved, "draft_info.json")];
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`No draft found at: ${input}\nExpected draft_content.json or draft_info.json`);
}

// --- DraftStore port -------------------------------------------------------
//
// The seam between draft domain logic and persistence. `LoadedDraft` carries
// everything save() needs (path, original bytes) so no module-global state is
// required — two drafts loaded in parallel no longer interfere. The legacy
// loadDraft/saveDraft functions below delegate to a process-wide default store
// so existing call sites keep working unchanged while commands migrate to
// injected stores (see D2+D3).

export interface LoadedDraft {
  draft: Draft;
  filePath: string;
  /** Original file bytes (BOM stripped) as loaded — preserved for .bak and indent fidelity. */
  raw: string;
}

export interface DraftStore {
  load(path: string): LoadedDraft;
  save(loaded: LoadedDraft): void;
}

export class LocalDraftStore implements DraftStore {
  load(path: string): LoadedDraft {
    const filePath = findDraft(path);
    // Tolerate a UTF-8 BOM: external Windows tools (PowerShell Set-Content) add
    // one and JSON.parse rejects it. save() re-serializes, so it never persists.
    let raw = readFileSync(filePath, "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return { draft: JSON.parse(raw) as Draft, filePath, raw };
  }

  save(loaded: LoadedDraft): void {
    const { draft, filePath, raw } = loaded;
    const draftDir = dirname(filePath);
    const identity = normalizeTimelineIdentity(draftDir, draft.id);
    const bakPath = `${filePath}.bak`;
    if (existsSync(filePath)) {
      writeFileSync(bakPath, raw, "utf-8");
    }
    // Detect original indent: if first line after { starts with tab use tab, else count spaces
    const serialized = JSON.stringify(draft, null, detectIndent(raw));
    writeFileSync(filePath, serialized, "utf-8");
    if (identity.renamed) syncTimelineRootBytes(draftDir, serialized);
  }
}

/**
 * Serialize + persist a loaded draft with full fidelity (.bak backup, original
 * indent, timeline-dir rename + root-bytes sync). Pass the raw bytes captured
 * at load time when available; pass "" when the draft was created in-memory
 * (initDraft) — indent then falls back to 0 and no meaningful .bak diff exists.
 */
export function persistDraft(store: DraftStore, filePath: string, draft: Draft, raw = ""): void {
  store.save({ draft, filePath, raw });
}

const defaultStore = new LocalDraftStore();

/** @deprecated Prefer an injected DraftStore. Kept as a thin facade over the default LocalDraftStore. */
export function loadDraft(path: string): { draft: Draft; filePath: string } {
  const { draft, filePath, raw } = defaultStore.load(path);
  loadedByPath.set(filePath, raw);
  return { draft, filePath };
}

/** @deprecated Prefer an injected DraftStore. Kept as a thin facade over the default LocalDraftStore. */
export function saveDraft(filePath: string, draft: Draft): void {
  // Facade path: recover the raw bytes captured by the matching loadDraft so
  // behaviour (backup + indent fidelity) is identical to the store path.
  const raw = loadedByPath.get(filePath) ?? (existsSync(filePath) ? readFileSync(filePath, "utf-8") : "");
  defaultStore.save({ draft, filePath, raw });
  loadedByPath.delete(filePath);
}

// Facade bookkeeping only: maps filePath -> raw bytes captured by loadDraft.
// Not semantically load-bearing — the store itself holds no state.
const loadedByPath = new Map<string, string>();

function detectIndent(raw: string | null): string | number {
  if (!raw) return 0;
  const match = raw.match(/\n(\s+)/);
  if (!match) return 0;
  const ws = match[1];
  if (ws.includes("\t")) return "\t";
  return ws.length;
}

export function extractText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed.text) return parsed.text;
  } catch {
    return content
      .replace(/<[^>]*>/g, "")
      .replace(/\[|\]/g, "")
      .trim();
  }
  return content;
}

export function updateTextContent(content: string, newText: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed.text !== undefined) {
      // Multi-span (keyword highlight) captions encode per-range offsets; naively
      // re-ranging styles[0] would desync the keyword spans → refuse instead of corrupt.
      if (Array.isArray(parsed.styles) && parsed.styles.length > 1) {
        throw new CliError(
          "Cannot set-text on a multi-span (keyword-highlight) caption — its style ranges would be corrupted. Rebuild it with `add-text --keyword` or `import-captions`.",
        );
      }
      parsed.text = newText;
      if (parsed.styles && parsed.styles.length > 0) {
        const encoded = Buffer.from(newText, "utf16le");
        parsed.styles[0].range = [0, encoded.length];
      }
      return JSON.stringify(parsed);
    }
  } catch (e) {
    if (e instanceof CliError) throw e; // never swallow the guard above
    const match = content.match(/^(.*\])?(.*?)(\[.*)?$/s);
    if (match) {
      return content.replace(/\[[^\]]*\]/, `[${newText}]`);
    }
  }
  return newText;
}

export function findSegment(draft: Draft, id: string): { track: Track; segment: Segment; index: number } | null {
  const shortId = id.toLowerCase();
  for (const track of draft.tracks) {
    for (let i = 0; i < track.segments.length; i++) {
      const seg = track.segments[i];
      if (seg.id === id || seg.id.toLowerCase().startsWith(shortId)) {
        return { track, segment: seg, index: i };
      }
    }
  }
  return null;
}

export function findMaterial<T extends { id: string }>(arr: T[], id: string): T | undefined {
  return arr.find((m) => m.id === id);
}

export function getTracksByType(draft: Draft, type: string): Track[] {
  return draft.tracks.filter((t) => t.type === type);
}

export function getMaterialTypes(draft: Draft): Array<{ type: string; count: number }> {
  return Object.entries(draft.materials)
    .filter(([, v]) => Array.isArray(v))
    .map(([type, arr]) => ({ type, count: arr.length }))
    .sort((a, b) => b.count - a.count);
}

export function findMaterialGlobal(
  draft: Draft,
  id: string,
): { type: string; material: Record<string, unknown> } | null {
  const shortId = id.toLowerCase();
  for (const [type, arr] of Object.entries(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    for (const mat of arr) {
      if (mat && typeof mat === "object" && typeof (mat as Record<string, unknown>).id === "string") {
        const m = mat as Record<string, unknown>;
        const matId = m.id as string;
        if (matId === id || matId.toLowerCase().startsWith(shortId)) {
          return { type, material: m };
        }
      }
    }
  }
  return null;
}
