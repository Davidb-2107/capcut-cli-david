import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Draft } from "../draft.js";

/**
 * CapCut portable-path token: `##_draftpath_placeholder_<UUID>_##` re-resolves
 * to the draft's own folder, so materials survive draft duplication/rename
 * (`v_slug` → `v_slug(1)`). The UUID is a per-install constant that is NOT
 * recorded in draft_meta_info.json / root_meta_info.json — so discovery, not
 * a hardcoded constant, is the primary source:
 *   1. Scan the current draft's own materials for a token already written
 *      (cutcli `videos add` writes one before any add-audio).
 *   2. Scan sibling draft dirs (same projects root) for ANY draft that has
 *      one — covers drafts our own `init` creates first, before any media
 *      referencing another draft has been added yet.
 *   3. Last resort: the observed CapCut/JianYing per-install constant. NOT
 *      `draft.id` — CapCut never substitutes an arbitrary GUID, so a
 *      draft-id-derived token is provably unresolvable (confirmed live:
 *      init-created drafts with no sibling token showed "loading media").
 */
const TOKEN_RE = /##_draftpath_placeholder_[0-9A-Fa-f-]+_##/;
const CAPCUT_PLACEHOLDER_CONSTANT = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";
const MAX_SIBLING_SCAN = 25;

function scanSiblingDrafts(filePath: string, ownDraftDir: string): string | undefined {
  const projectsRoot = dirname(ownDraftDir);
  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return undefined;
  }
  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= MAX_SIBLING_SCAN) break;
    const dirPath = join(projectsRoot, entry);
    if (dirPath === ownDraftDir) continue;
    try {
      if (!statSync(dirPath).isDirectory()) continue;
      const contentPath = join(dirPath, "draft_content.json");
      const raw = readFileSync(contentPath, "utf-8");
      scanned++;
      const match = TOKEN_RE.exec(raw);
      if (match) return match[0];
    } catch {
      // unreadable sibling (no draft_content.json, permissions, etc.) — skip
      continue;
    }
  }
  return undefined;
}

export function draftPlaceholderToken(draft: Draft, filePath?: string): string {
  for (const mats of [draft.materials.videos, draft.materials.audios]) {
    for (const m of mats ?? []) {
      const p = (m as { path?: unknown }).path;
      if (typeof p === "string") {
        const match = TOKEN_RE.exec(p);
        if (match) return match[0];
      }
    }
  }
  if (filePath) {
    const sibling = scanSiblingDrafts(filePath, dirname(filePath));
    if (sibling) return sibling;
  }
  return CAPCUT_PLACEHOLDER_CONSTANT;
}
