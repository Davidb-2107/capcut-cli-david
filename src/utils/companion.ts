import { randomUUID } from "node:crypto";
import type { Draft, Segment, Timerange } from "../draft.js";

let uuidProvider: (() => string) | null = null;

// Override the UUID source for deterministic builds (pipeline --seed).
// Pass null to restore randomUUID.
export function setUuidProvider(fn: (() => string) | null): void {
  uuidProvider = fn;
}

export function uuid(): string {
  return uuidProvider ? uuidProvider() : randomUUID();
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export interface CompanionRefs {
  ids: string[];
  materials: Array<{ type: string; data: Record<string, unknown> }>;
}

export function createCompanionMaterials(trackType: "text" | "video" | "audio"): CompanionRefs {
  const speed = { id: uuid(), type: "speed", speed: 1, mode: 0, curve_speed: null };
  const placeholder = {
    id: uuid(),
    type: "placeholder_info",
    error_path: "",
    error_text: "",
    meta_type: "none",
    res_path: "",
    res_text: "",
  };
  const scm = {
    id: uuid(),
    type: "none",
    audio_channel_mapping: 0,
    is_config_open: false,
  };
  const vocal = {
    id: uuid(),
    type: "vocal_separation",
    choice: 0,
    enter_from: "",
    final_algorithm: "",
    production_path: "",
    removed_sounds: [],
    time_range: null,
  };

  const refs: CompanionRefs = {
    ids: [speed.id, placeholder.id, scm.id, vocal.id],
    materials: [
      { type: "speeds", data: speed },
      { type: "placeholder_infos", data: placeholder },
      { type: "sound_channel_mappings", data: scm },
      { type: "vocal_separations", data: vocal },
    ],
  };

  if (trackType === "video") {
    const canvas = {
      id: uuid(),
      type: "canvas_color",
      album_image: "",
      blur: 0,
      color: "",
      image: "",
      image_id: "",
      image_name: "",
      source_platform: 0,
      team_id: "",
    };
    const matColor = {
      id: uuid(),
      type: "material_color",
      gradient_angle: 90,
      gradient_colors: [],
      gradient_percents: [],
      height: 0,
      is_color_clip: false,
      is_gradient: false,
      solid_color: "",
      width: 0,
    };
    refs.ids.push(canvas.id, matColor.id);
    refs.materials.push({ type: "canvases", data: canvas }, { type: "material_colors", data: matColor });
  }

  return refs;
}

export function registerCompanions(draft: Draft, companions: CompanionRefs): void {
  for (const { type, data } of companions.materials) {
    if (!draft.materials[type]) draft.materials[type] = [];
    draft.materials[type].push(data);
  }
}

export function baseSegment(
  id: string,
  materialId: string,
  trackId: string,
  timerange: Timerange,
  companionIds: string[],
  renderIndex: number,
): Segment {
  return {
    id,
    material_id: materialId,
    raw_segment_id: trackId,
    target_timerange: { ...timerange },
    source_timerange: { start: 0, duration: timerange.duration },
    speed: 1,
    volume: 1,
    visible: true,
    reverse: false,
    clip: {
      alpha: 1,
      rotation: 0,
      scale: { x: 1, y: 1 },
      transform: { x: 0, y: 0 },
      flip: { horizontal: false, vertical: false },
    },
    render_index: renderIndex,
    track_render_index: 0,
    track_attribute: 0,
    extra_material_refs: companionIds,
    common_keyframes: [],
    keyframe_refs: [],
  } as unknown as Segment;
}
