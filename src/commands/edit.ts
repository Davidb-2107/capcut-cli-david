import {
  type Draft,
  extractText,
  findMaterial,
  findSegment,
  getTracksByType,
  saveDraft,
  updateTextContent,
} from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { parseTimeInput } from "../utils/time.js";

export function cmdSetText(
  draft: Draft,
  filePath: string,
  segId: string,
  newText: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const mat = findMaterial(draft.materials.texts, result.segment.material_id);
  if (!mat) die(`Text material not found for segment ${segId}`);
  const oldText = extractText(mat.content);
  mat.content = updateTextContent(mat.content, newText);
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old: oldText, new: newText }, flags);
}

export function cmdShift(
  draft: Draft,
  filePath: string,
  segId: string,
  offsetStr: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const offset = parseTimeInput(offsetStr);
  const seg = result.segment;
  const oldStart = seg.target_timerange.start;
  seg.target_timerange.start = Math.max(0, oldStart + offset);
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: seg.id, old_start_us: oldStart, new_start_us: seg.target_timerange.start }, flags);
}

export function cmdShiftAll(draft: Draft, filePath: string, offsetStr: string, flags: Flags, save = true): void {
  const offset = parseTimeInput(offsetStr);
  const tracks = flags.track ? getTracksByType(draft, flags.track) : draft.tracks;
  let count = 0;
  for (const track of tracks) {
    for (const seg of track.segments) {
      seg.target_timerange.start = Math.max(0, seg.target_timerange.start + offset);
      count++;
    }
  }
  if (save) saveDraft(filePath, draft);
  out({ ok: true, shifted: count, offset_us: offset }, flags);
}

export function cmdSpeed(
  draft: Draft,
  filePath: string,
  segId: string,
  multiplier: string,
  flags: Flags,
  save = true,
): void {
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
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: seg.id, old_speed: oldSpeed, new_speed: speed }, flags);
}

export function cmdVolume(
  draft: Draft,
  filePath: string,
  segId: string,
  levelStr: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const level = parseFloat(levelStr);
  if (Number.isNaN(level) || level < 0) die("Volume must be >= 0");
  const old = result.segment.volume;
  result.segment.volume = level;
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old_volume: old, new_volume: level }, flags);
}

export function cmdTrim(
  draft: Draft,
  filePath: string,
  segId: string,
  startStr: string,
  durationStr: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const seg = result.segment;
  seg.source_timerange.start = start;
  seg.source_timerange.duration = duration;
  seg.target_timerange.duration = Math.round(duration / seg.speed);
  if (save) saveDraft(filePath, draft);
  out(
    {
      ok: true,
      id: seg.id,
      source_start_us: start,
      source_duration_us: duration,
      target_duration_us: seg.target_timerange.duration,
    },
    flags,
  );
}

export function cmdOpacity(
  draft: Draft,
  filePath: string,
  segId: string,
  alphaStr: string,
  flags: Flags,
  save = true,
): void {
  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const alpha = parseFloat(alphaStr);
  if (Number.isNaN(alpha) || alpha < 0 || alpha > 1) die("Opacity must be 0.0-1.0");
  if (!result.segment.clip) die(`Segment ${segId} has no clip (audio segment?)`);
  const old = result.segment.clip.alpha;
  result.segment.clip.alpha = alpha;
  if (save) saveDraft(filePath, draft);
  out({ ok: true, id: result.segment.id, old_opacity: old, new_opacity: alpha }, flags);
}
