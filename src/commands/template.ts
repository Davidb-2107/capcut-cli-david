import { readFileSync, writeFileSync } from "node:fs";
import { type Draft, findMaterialGlobal, type Segment, saveDraft, type Track } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { createCompanionMaterials, registerCompanions, uuid } from "../utils/companion.js";
import { parseTimeInput } from "../utils/time.js";

export interface Template {
  name: string;
  type: string;
  segment: Record<string, unknown>;
  material: { type: string; data: Record<string, unknown> };
  extra_materials: Array<{ type: string; data: Record<string, unknown> }>;
}

function deepCloneWithIdRemap(obj: Record<string, unknown>, remapId: (old: string) => string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  if (typeof clone.id === "string") {
    clone.id = remapId(clone.id as string);
  }
  return clone;
}

export function saveTemplate(draft: Draft, segId: string, name: string, outPath: string): Template {
  const shortId = segId.toLowerCase();
  let foundSeg: Segment | null = null;
  let foundTrack: Track | null = null;

  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      if (seg.id === segId || seg.id.toLowerCase().startsWith(shortId)) {
        foundSeg = seg;
        foundTrack = track;
        break;
      }
    }
    if (foundSeg) break;
  }

  if (!foundSeg || !foundTrack) throw new Error(`Segment not found: ${segId}`);

  const mat = findMaterialGlobal(draft, foundSeg.material_id);
  if (!mat) throw new Error(`Material not found for segment: ${segId}`);

  const extras: Array<{ type: string; data: Record<string, unknown> }> = [];
  for (const refId of foundSeg.extra_material_refs) {
    const extra = findMaterialGlobal(draft, refId);
    if (extra) extras.push({ type: extra.type, data: { ...extra.material } });
  }

  const template: Template = {
    name,
    type: foundTrack.type,
    segment: { ...foundSeg } as unknown as Record<string, unknown>,
    material: { type: mat.type, data: { ...mat.material } },
    extra_materials: extras,
  };

  writeFileSync(outPath, JSON.stringify(template, null, 2), "utf-8");
  return template;
}

export function applyTemplate(
  draft: Draft,
  templatePath: string,
  start: number,
  duration: number,
  overrides?: { x?: number; y?: number; scaleX?: number; scaleY?: number; text?: string },
): { segmentId: string; materialId: string; trackId: string } {
  const template = JSON.parse(readFileSync(templatePath, "utf-8")) as Template;

  const idMap = new Map<string, string>();
  function remapId(oldId: string): string {
    if (!idMap.has(oldId)) idMap.set(oldId, uuid());
    return idMap.get(oldId)!;
  }

  const newSegId = uuid();
  const newMatId = uuid();

  const newMat = deepCloneWithIdRemap(template.material.data, remapId);
  newMat.id = newMatId;

  if (overrides?.text && template.type === "text" && typeof newMat.content === "string") {
    try {
      const parsed = JSON.parse(newMat.content as string);
      if (parsed.text !== undefined) {
        parsed.text = overrides.text;
        if (parsed.styles && parsed.styles.length > 0) {
          const encoded = Buffer.from(overrides.text, "utf16le");
          parsed.styles[0].range = [0, encoded.length];
        }
        newMat.content = JSON.stringify(parsed);
      }
    } catch {
      /* keep original content */
    }
  }

  if (!draft.materials[template.material.type]) draft.materials[template.material.type] = [];
  draft.materials[template.material.type].push(newMat);

  const newExtraIds: string[] = [];
  for (const extra of template.extra_materials) {
    const newExtra = deepCloneWithIdRemap(extra.data, remapId);
    newExtraIds.push(newExtra.id as string);
    if (!draft.materials[extra.type]) draft.materials[extra.type] = [];
    draft.materials[extra.type].push(newExtra);
  }

  if (newExtraIds.length === 0) {
    const companions = createCompanionMaterials(template.type as "text" | "video" | "audio");
    registerCompanions(draft, companions);
    newExtraIds.push(...companions.ids);
  }

  let track = draft.tracks.find((t) => t.type === template.type);
  if (!track) {
    track = {
      id: uuid(),
      type: template.type,
      name: template.name || template.type,
      attribute: 0,
      segments: [],
      is_default_name: true,
      flag: 0,
    } as unknown as Track;
    draft.tracks.push(track);
  }

  const newSeg = { ...template.segment } as Record<string, unknown>;
  newSeg.id = newSegId;
  newSeg.material_id = newMatId;
  newSeg.raw_segment_id = track.id;
  newSeg.target_timerange = { start, duration };
  if (template.segment.source_timerange) {
    newSeg.source_timerange = { start: 0, duration };
  }
  newSeg.extra_material_refs = newExtraIds;

  if (overrides && newSeg.clip && typeof newSeg.clip === "object") {
    const clip = newSeg.clip as Record<string, unknown>;
    if (overrides.x !== undefined || overrides.y !== undefined) {
      clip.transform = {
        x: overrides.x ?? (clip.transform as Record<string, number>)?.x ?? 0,
        y: overrides.y ?? (clip.transform as Record<string, number>)?.y ?? 0,
      };
    }
    if (overrides.scaleX !== undefined || overrides.scaleY !== undefined) {
      clip.scale = {
        x: overrides.scaleX ?? (clip.scale as Record<string, number>)?.x ?? 1,
        y: overrides.scaleY ?? (clip.scale as Record<string, number>)?.y ?? 1,
      };
    }
  }

  track.segments.push(newSeg as unknown as Segment);

  return { segmentId: newSegId, materialId: newMatId, trackId: track.id };
}

// --- CLI wrappers ---

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

export function cmdApplyTemplate(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
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
  saveDraft(filePath, draft);
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
