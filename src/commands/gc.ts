import type { Draft } from "../draft.js";
import { collectOrphans } from "./validate.js";

// gc — removes the segment-orphan text/video/audio materials that `validate`
// reports as info (the leftovers import-captions/restyle leave behind). Scope is
// the SOLE data-safety guarantee: only materials.texts/videos/audios, where
// segment-reachability is total reachability (0 material->material edges, verified
// across all fixtures). It NEVER touches any other slot, never deletes a disk
// asset, and never writes when there is nothing to remove.

export interface GcPlan {
  texts: string[];
  videos: string[];
  audios: string[];
  /** Texts skipped because their text_to_audio_ids names other-material ids —
   * the one documented out-of-sample cross-ref; conservative do-not-delete. */
  skipped_cross_ref: string[];
  total: number;
}

function textToAudioIds(m: unknown): string[] {
  const v = (m as { text_to_audio_ids?: unknown }).text_to_audio_ids;
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
}

/** Pure: the removal plan. Orphans come from validate's shared definition; a
 * text carrying a non-empty text_to_audio_ids is moved to skipped_cross_ref. */
export function planGc(draft: Draft): GcPlan {
  const orphans = collectOrphans(draft);
  const skipped: string[] = [];
  const texts: string[] = [];
  const byId = new Map<string, unknown>();
  if (Array.isArray(draft.materials.texts)) {
    for (const m of draft.materials.texts) byId.set((m as { id?: string }).id ?? "", m);
  }
  for (const id of orphans.texts) {
    if (textToAudioIds(byId.get(id)).length > 0) skipped.push(id);
    else texts.push(id);
  }
  return {
    texts,
    videos: orphans.videos,
    audios: orphans.audios,
    skipped_cross_ref: skipped,
    total: texts.length + orphans.videos.length + orphans.audios.length,
  };
}

/** Mutate the draft: rebuild each of the three slots without the planned ids.
 * Sound because duplicate ids are pre-excluded (gc refuses on hasBlockingErrors),
 * so an id-based filter can never remove a referenced twin. */
export function applyGc(draft: Draft, plan: GcPlan): void {
  // View the typed slots through the index signature so a computed-key filter
  // assignment doesn't trip the per-slot element types.
  const mats = draft.materials as unknown as Record<string, Array<{ id?: string }>>;
  const drop = (slot: "texts" | "videos" | "audios", ids: string[]): void => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const arr = mats[slot];
    if (Array.isArray(arr)) mats[slot] = arr.filter((m) => !set.has(m.id ?? ""));
  };
  drop("texts", plan.texts);
  drop("videos", plan.videos);
  drop("audios", plan.audios);
}
