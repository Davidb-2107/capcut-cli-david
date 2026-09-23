import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Draft } from "../draft.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { buildDraftMetaInfo } from "../utils/draft-meta.js";

// init-meta — generates the missing draft_meta_info.json that validate's
// meta.missing detects (without it a draft is invisible in CapCut and register
// fails). POSTURE IS INVERSE of sync-timelines/gc: an EXISTING sidecar is
// presumed authoritative (real draft_id / tm_* / cloud refs), and meta.missing
// only fires when ABSENT — so init-meta REFUSES to clobber an existing sidecar
// without --force. Writes ONLY draft_meta_info.json (never draft_info.json /
// root_meta_info.json, except the opt-in --register substep).

export interface InitMetaPlan {
  meta: Record<string, unknown>;
  draftId: string;
  draftName: string;
  /** true when draft_content.json had no usable id and we minted one. */
  generatedId: boolean;
}

/** Pure: derive the sidecar object from the draft + its dir. Identity comes from
 * DISK (basename) and the content's draft.id, matching register's rules so the
 * two never fight. draft_root_path is the PARENT of the draft dir (pipeline's
 * semantics), never the projects-root. */
export function planInitMeta(draft: Draft, draftDir: string): InitMetaPlan {
  const dir = resolve(draftDir);
  const hasId = typeof draft.id === "string" && draft.id !== "";
  const draftId = hasId ? draft.id : randomUUID();
  const draftName = basename(dir);
  const totalDurationUs = typeof draft.duration === "number" ? draft.duration : 0;
  const meta = buildDraftMetaInfo({
    draftId,
    draftName,
    draftFoldPath: dir,
    draftRootPath: dirname(dir),
    totalDurationUs,
  });
  return { meta, draftId, draftName, generatedId: !hasId };
}

/** Write the sidecar to disk. If one already exists, back it up FIRST (bak-first,
 * like persistDraft) so a forced overwrite stays recoverable. CREATE path = exactly
 * one trailing write (a read-only dir throws here with nothing half-written).
 * Extracted from cmdInitMeta so the `validate --fix` umbrella can apply init-meta
 * without re-parsing or re-emitting an envelope. */
export function applyInitMeta(plan: InitMetaPlan, metaPath: string): void {
  if (existsSync(metaPath)) {
    copyFileSync(metaPath, `${metaPath}.bak`);
    process.stderr.write(`WARNING init-meta overwrote an existing draft_meta_info.json (backup: ${metaPath}.bak).\n`);
  }
  // Audit CLI-M3: atomic final write (the .bak above stays the recovery path).
  writeFileAtomic(metaPath, JSON.stringify(plan.meta, null, 0));
}
