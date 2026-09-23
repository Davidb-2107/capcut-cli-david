import { type Draft, type DraftStore, LocalDraftStore, persistDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { parseTimeInput } from "../utils/time.js";
import { applyTemplate, saveTemplate } from "./template.js";

export function cmdSaveTemplate(draft: Draft, positional: string[], flags: Flags): void {
  const segId = positional[2];
  const name = positional[3];
  if (!flags.out) die("Missing --out <path>. Usage: capcut-david save-template <project> <id> <name> --out <path>");
  const template = saveTemplate(draft, segId, name, flags.out);
  out(
    {
      ok: true,
      name: template.name,
      type: template.type,
      material_type: template.material.type,
      extra_materials: template.extra_materials.length,
      out: flags.out,
    },
    flags,
  );
}

export function cmdApplyTemplate(
  draft: Draft,
  filePath: string,
  positional: string[],
  flags: Flags,
  store: DraftStore = new LocalDraftStore(),
): void {
  const templatePath = positional[2];
  const startStr = positional[3];
  const durationStr = positional[4];
  const start = parseTimeInput(startStr);
  const duration = parseTimeInput(durationStr);
  const textOverride = positional.length > 5 ? positional.slice(5).join(" ") : undefined;
  const result = applyTemplate(draft, templatePath, start, duration, {
    x: flags.x,
    y: flags.y,
    text: textOverride,
  });
  persistDraft(store, filePath, draft);
  out(
    {
      ok: true,
      segment_id: result.segmentId,
      material_id: result.materialId,
      track_id: result.trackId,
      start_us: start,
      duration_us: duration,
    },
    flags,
  );
}
