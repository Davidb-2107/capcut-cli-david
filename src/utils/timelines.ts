import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
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

export interface TimelineIdentityNormalization {
  renamed: boolean;
  from: string | null;
  to: string | null;
}

/**
 * Keep a copied CapCut draft's primary timeline identity aligned with its root
 * draft_content.json. CapCut addresses the first-open timeline by the
 * Timelines/<guid> directory and its project/layout metadata; changing only
 * draft_content.id leaves a draft visible but unreadable.
 *
 * This is intentionally conservative: a draft with several timelines is not
 * guessed at. A caller must preserve its existing multi-timeline structure or
 * repair it explicitly instead of silently renaming one of the timelines.
 */
export function normalizeTimelineIdentity(draftDir: string, draftId: string): TimelineIdentityNormalization {
  if (!draftId) return { renamed: false, from: null, to: null };
  const timelinesRoot = join(draftDir, "Timelines");
  // A bare Timelines/<guid>/draft_content.json is also used by older tooling
  // and by lightweight fixtures. Only normalize the full CapCut timeline shape
  // that carries the identity metadata which makes the mismatch meaningful.
  if (!existsSync(join(timelinesRoot, "project.json")) && !existsSync(join(draftDir, "timeline_layout.json"))) {
    return { renamed: false, from: null, to: null };
  }
  const dirs = listTimelineDirs(draftDir);
  if (dirs.length === 0) return { renamed: false, from: null, to: null };
  if (dirs.some(({ guid }) => guid.toLowerCase() === draftId.toLowerCase())) {
    return { renamed: false, from: null, to: null };
  }
  if (dirs.length !== 1) {
    throw new Error(
      `Cannot normalize CapCut timeline identity for ${draftDir}: found ${dirs.length} timeline directories and none matches draft_content.id ${draftId}`,
    );
  }

  const from = dirs[0].guid;
  const fromDir = dirs[0].dir;
  const toDir = join(timelinesRoot, draftId);
  renameSync(fromDir, toDir);

  // These files carry the timeline UUID outside draft_content.json. Keep
  // backups/journals untouched: they are rollback history, not live state.
  const liveIdentityFiles = [
    join(draftDir, "timeline_layout.json"),
    join(timelinesRoot, "project.json"),
    join(toDir, "attachment", "patch", "mini_draft.json"),
    join(toDir, "attachment", "patch", "patch.json"),
  ];
  for (const file of liveIdentityFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf-8");
    const patched = text.replaceAll(from, draftId);
    if (patched !== text) writeFileSync(file, patched, "utf-8");
  }

  return { renamed: true, from, to: draftId };
}

/** Write the finalized root bytes to the live first-open mirrors after an
 * identity repair. Existing files only are touched; no CapCut sidecar is
 * fabricated here. */
export function syncTimelineRootBytes(draftDir: string, rootBytes: string): void {
  for (const { dir } of listTimelineDirs(draftDir)) {
    for (const rel of ["draft_content.json", "draft_info.json", "template-2.tmp"]) {
      const file = join(dir, rel);
      if (!existsSync(file)) continue;
      writeFileSync(file, rootBytes, "utf-8");
    }
  }
  const rootTmp = join(draftDir, "template-2.tmp");
  if (existsSync(rootTmp)) writeFileSync(rootTmp, rootBytes, "utf-8");
}
