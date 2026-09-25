import { dirname } from "node:path";
import { type Draft, type DraftStore, LocalDraftStore, persistDraft } from "../draft.js";
import { CliError, type Flags, out } from "../utils/cli.js";
import { applyRemoveSegment } from "./remove-segment.js";
import { hasBlockingErrors } from "./validate.js";

export function cmdRemoveSegment(
  draft: Draft,
  filePath: string,
  positional: string[],
  flags: Flags,
  store: DraftStore = new LocalDraftStore(),
): void {
  // A dangling ref or duplicate material id makes the sweep unsafe.
  if (hasBlockingErrors(draft)) {
    throw new CliError(
      "remove-segment refuses: draft has error-level problems (dangling reference or duplicate material id). Run `capcut-david validate` and fix them first.",
    );
  }

  const segId = positional[2];
  const result = applyRemoveSegment(draft, segId);
  if (!result) throw new CliError(`Segment not found: ${segId}`);

  persistDraft(store, filePath, draft);
  out(
    {
      schema: "capcut-david/remove-segment@1",
      ok: true,
      segment_id: result.segmentId,
      track_id: result.trackId,
      track_removed: result.trackRemoved,
      materials_removed: result.materialsRemoved,
      project: dirname(filePath),
    },
    flags,
  );
}
