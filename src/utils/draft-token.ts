import type { Draft } from "../draft.js";

/**
 * CapCut portable-path token: `##_draftpath_placeholder_<UUID>_##` re-resolves
 * to the draft's own folder, so materials survive draft duplication/rename
 * (`v_slug` → `v_slug(1)`). The UUID is a per-install constant that is NOT
 * recorded in draft_meta_info.json / root_meta_info.json — so we never
 * hardcode it: we scan a token already written into this draft (cutcli
 * `videos add` writes one before any add-audio). Fallback for token-less
 * drafts: derive from the draft's own GUID.
 */
const TOKEN_RE = /##_draftpath_placeholder_[0-9A-Fa-f-]+_##/;

export function draftPlaceholderToken(draft: Draft): string {
  for (const mats of [draft.materials.videos, draft.materials.audios]) {
    for (const m of mats ?? []) {
      const p = (m as { path?: unknown }).path;
      if (typeof p === "string") {
        const match = TOKEN_RE.exec(p);
        if (match) return match[0];
      }
    }
  }
  return `##_draftpath_placeholder_${draft.id}_##`;
}
