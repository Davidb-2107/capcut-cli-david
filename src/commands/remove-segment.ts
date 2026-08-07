import { dirname } from "node:path";
import { type Draft, findSegment, saveDraft } from "../draft.js";
import { CliError, type Flags, out } from "../utils/cli.js";
import { applyGc, planGc } from "./gc.js";
import { hasBlockingErrors } from "./validate.js";

// remove-segment — remove one segment from its track, drop the track when it
// becomes empty, then sweep the materials this removal orphaned via gc's
// shared plan (planGc/applyGc). Reusing the plan inherits gc's data-safety
// guarantee: a material still referenced by ANY other segment is never deleted,
// and the sweep only ever touches materials.texts/videos/audios.

export function cmdRemoveSegment(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  // Same refusal as gc: a dangling ref means the draft is already inconsistent,
  // a duplicate material id makes the id-based sweep ambiguous.
  if (hasBlockingErrors(draft)) {
    throw new CliError(
      "remove-segment refuses: draft has error-level problems (dangling reference or duplicate material id). Run `capcut-david validate` and fix them first.",
    );
  }

  const segId = positional[2];
  const hit = findSegment(draft, segId);
  if (!hit) throw new CliError(`Segment not found: ${segId}`);
  const { track, segment, index } = hit;

  track.segments.splice(index, 1);
  const trackRemoved = track.segments.length === 0;
  if (trackRemoved) draft.tracks = draft.tracks.filter((t) => t !== track);

  // Sweep what the removal orphaned (plus any pre-existing orphans — same
  // definition validate/gc share, so the two verbs never drift).
  const plan = planGc(draft);
  applyGc(draft, plan);

  saveDraft(filePath, draft);

  out(
    {
      schema: "capcut-david/remove-segment@1",
      ok: true,
      segment_id: segment.id,
      track_id: track.id,
      track_removed: trackRemoved,
      materials_removed: plan.total,
      project: dirname(filePath),
    },
    flags,
  );
}
