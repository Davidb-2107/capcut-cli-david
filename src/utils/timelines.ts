import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Shared enumerator for CapCut's per-draft timeline mirrors. Once CapCut opens a
// draft it materialises <draft>/Timelines/<guid>/draft_content.json (+ sidecars)
// as its own timeline source of truth. This lists those <guid> dirs.
//
// Single source of the walk for mirror.ts (font mirroring), validate.ts
// (timelines.divergence detection) and sync-timelines.ts (the fixer) so all
// three agree on what counts as a timeline mirror. The `.DS_Store` / stray-file
// guard matters — Timelines/ can hold non-directory cruft.
export function listTimelineDirs(draftDir: string): Array<{ guid: string; dir: string }> {
  const root = join(draftDir, "Timelines");
  if (!existsSync(root)) return [];
  const out: Array<{ guid: string; dir: string }> = [];
  for (const guid of readdirSync(root)) {
    const dir = join(root, guid);
    if (statSync(dir).isDirectory()) out.push({ guid, dir });
  }
  return out;
}
