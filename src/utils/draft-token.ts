import type { Draft } from "../draft.js";

/**
 * CapCut portable-path token: `##_draftpath_placeholder_<UUID>_##` re-resolves
 * to the draft's own folder, so materials survive draft duplication/rename
 * (`v_slug` → `v_slug(1)`). Discovery chain:
 *   1. Scan the current draft's own materials for a token already written
 *      (compat: drafts that already carry a token keep it — also covers a
 *      hypothetical install using a different placeholder constant).
 *   2. Fall back to the hardcoded constant below — observed on this install
 *      AND used verbatim by public JianYing draft SDKs. NOT `draft.id`:
 *      CapCut never substitutes an arbitrary GUID, so a draft-id-derived
 *      token is provably unresolvable (confirmed live: init-created drafts
 *      with such tokens showed "loading media" on every clip). No sibling
 *      scan either — TOKEN_RE can't tell a legit token from a stale broken
 *      draft.id token written by pre-fix code, so scanning siblings could
 *      adopt and propagate a broken one.
 */
const TOKEN_RE = /##_draftpath_placeholder_[0-9A-Fa-f-]+_##/;
const CAPCUT_PLACEHOLDER_CONSTANT = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";

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
  return CAPCUT_PLACEHOLDER_CONSTANT;
}
