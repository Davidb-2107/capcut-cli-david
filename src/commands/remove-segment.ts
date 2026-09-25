import { type Draft, findSegment } from "../draft.js";
import { applyGc, planGc } from "./gc.js";

// Mutate the loaded draft only; the CLI owns validation, persistence and output.
export function applyRemoveSegment(draft: Draft, segId: string) {
  const hit = findSegment(draft, segId);
  if (!hit) return null;
  const { track, segment, index } = hit;

  track.segments.splice(index, 1);
  const trackRemoved = track.segments.length === 0;
  if (trackRemoved) draft.tracks = draft.tracks.filter((t) => t !== track);

  // gc's shared plan only sweeps text/video/audio materials and preserves
  // anything still referenced by another segment.
  const plan = planGc(draft);
  applyGc(draft, plan);

  return {
    segmentId: segment.id,
    trackId: track.id,
    trackRemoved,
    materialsRemoved: plan.total,
  };
}
