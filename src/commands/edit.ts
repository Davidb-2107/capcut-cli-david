import { type Draft, extractText, findMaterial, findSegment, getTracksByType, updateTextContent } from "../draft.js";
import { die } from "../utils/cli.js";
import { parseTimeInput } from "../utils/time.js";

// --- Application layer (pure, no I/O, no process.exit) ---------------------
//
// Each apply* function is the named application function for one edit verb:
// it takes a loaded draft and typed params, mutates the draft, and returns the
// result payload. Persistence is the caller's job via an injected DraftStore
// (see D2+D3) — these functions never touch the filesystem.

export interface EditResult {
  ok: true;
  id: string;
  [key: string]: unknown;
}

export function applySetText(draft: Draft, segId: string, newText: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const mat = findMaterial(draft.materials.texts, result.segment.material_id);
  if (!mat) die(`Text material not found for segment ${segId}`);
  const oldText = extractText(mat.content);
  mat.content = updateTextContent(mat.content, newText);
  return { ok: true, id: result.segment.id, old: oldText, new: newText };
}

export function applyShift(draft: Draft, segId: string, offsetStr: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const offset = parseTimeInput(offsetStr);
  const seg = result.segment;
  const oldStart = seg.target_timerange.start;
  seg.target_timerange.start = Math.max(0, oldStart + offset);
  return { ok: true, id: seg.id, old_start_us: oldStart, new_start_us: seg.target_timerange.start };
}

export function applyShiftAll(draft: Draft, offsetStr: string, trackType?: string): EditResult {
  const offset = parseTimeInput(offsetStr);
  const tracks = trackType ? getTracksByType(draft, trackType) : draft.tracks;
  let count = 0;
  for (const track of tracks) {
    for (const seg of track.segments) {
      seg.target_timerange.start = Math.max(0, seg.target_timerange.start + offset);
      count++;
    }
  }
  return { ok: true, shifted: count, offset_us: offset, id: "" };
}

export function applySpeed(draft: Draft, segId: string, multiplier: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const speed = parseFloat(multiplier);
  if (Number.isNaN(speed) || speed <= 0) die("Speed must be a positive number");
  const seg = result.segment;
  const oldSpeed = seg.speed;
  seg.speed = speed;
  seg.source_timerange.duration = Math.round(seg.target_timerange.duration * speed);
  for (const refId of seg.extra_material_refs) {
    const speedMat = findMaterial(draft.materials.speeds, refId);
    if (speedMat) speedMat.speed = speed;
  }
  return { ok: true, id: seg.id, old_speed: oldSpeed, new_speed: speed };
}

export function applyVolume(draft: Draft, segId: string, levelStr: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const level = parseFloat(levelStr);
  if (Number.isNaN(level) || level < 0) die("Volume must be >= 0");
  const old = result.segment.volume;
  result.segment.volume = level;
  return { ok: true, id: result.segment.id, old_volume: old, new_volume: level };
}

export function applyTrim(draft: Draft, segId: string, startStr: string, durationStr: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const seg = result.segment;
  seg.source_timerange.start = start;
  seg.source_timerange.duration = duration;
  seg.target_timerange.duration = Math.round(duration / seg.speed);
  return {
    ok: true,
    id: seg.id,
    source_start_us: start,
    source_duration_us: duration,
    target_duration_us: seg.target_timerange.duration,
  };
}

export function applyOpacity(draft: Draft, segId: string, alphaStr: string): EditResult {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const alpha = parseFloat(alphaStr);
  if (Number.isNaN(alpha) || alpha < 0 || alpha > 1) die("Opacity must be 0.0-1.0");
  if (!result.segment.clip) die(`Segment ${segId} has no clip (audio segment?)`);
  const old = result.segment.clip.alpha;
  result.segment.clip.alpha = alpha;
  return { ok: true, id: result.segment.id, old_opacity: old, new_opacity: alpha };
}
