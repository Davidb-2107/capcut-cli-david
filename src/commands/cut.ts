import type { Draft } from "../draft.js";

export interface CutOptions {
  start: number;
  end: number;
}

export function cutProject(draft: Draft, opts: CutOptions): { kept: number; removed: number } {
  const { start, end } = opts;
  const duration = end - start;
  let kept = 0;
  let removed = 0;

  const removedMaterialIds = new Set<string>();
  const removedExtraRefs = new Set<string>();

  for (const track of draft.tracks) {
    const surviving: typeof track.segments = [];

    for (const seg of track.segments) {
      const segStart = seg.target_timerange.start;
      const segEnd = segStart + seg.target_timerange.duration;

      if (segEnd <= start || segStart >= end) {
        removedMaterialIds.add(seg.material_id);
        for (const ref of seg.extra_material_refs) removedExtraRefs.add(ref);
        removed++;
        continue;
      }

      const clippedStart = Math.max(segStart, start);
      const clippedEnd = Math.min(segEnd, end);
      const trimFromStart = clippedStart - segStart;
      const newDuration = clippedEnd - clippedStart;

      if (seg.source_timerange) {
        seg.source_timerange.start += Math.round(trimFromStart * seg.speed);
        seg.source_timerange.duration = Math.round(newDuration * seg.speed);
      }

      seg.target_timerange.start = clippedStart - start;
      seg.target_timerange.duration = newDuration;

      surviving.push(seg);
      kept++;
    }

    track.segments = surviving;
  }

  draft.tracks = draft.tracks.filter((t) => t.segments.length > 0);

  const survivingMatIds = new Set<string>();
  const survivingExtraRefs = new Set<string>();
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      survivingMatIds.add(seg.material_id);
      for (const ref of seg.extra_material_refs) survivingExtraRefs.add(ref);
    }
  }

  for (const [key, arr] of Object.entries(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    draft.materials[key] = arr.filter((m: Record<string, unknown>) => {
      if (!m || typeof m.id !== "string") return true;
      const id = m.id as string;
      if (survivingMatIds.has(id) || survivingExtraRefs.has(id)) return true;
      if (removedMaterialIds.has(id) || removedExtraRefs.has(id)) return false;
      return true;
    });
  }

  draft.duration = duration;

  return { kept, removed };
}
