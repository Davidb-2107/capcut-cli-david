import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Draft } from "../draft.js";
import { CliError, type Flags, out } from "../utils/cli.js";
import { listTimelineDirs } from "../utils/timelines.js";

// sync-timelines — the WRITE verb that repairs the divergence validate's
// read-only `timelines.divergence` detects. CapCut, once it opens a draft,
// treats <draft>/Timelines/<guid>/draft_content.json as ITS timeline source of
// truth; a later CLI re-patch of the root leaves that mirror stale and CapCut
// renders the old state. This copies the ROOT draft_content.json (RAW bytes)
// back into every mirror so root + mirrors agree again.
//
// Direction is ALWAYS root -> mirror, never inferred from mtime (cp/cloud/AV
// rewrite mtimes). Data-loss net: CapCut-closed guard (in index.ts) + a
// timestamped, non-clobbering per-file backup + skip-when-byte-identical.

export interface SyncOptions {
  dryRun?: boolean;
  /** Epoch ms stamped into backup filenames; injectable for deterministic tests. */
  nowMs?: number;
}

export interface SyncGuidResult {
  guid: string;
  /** true when a CapCut-read mirror (draft_content.json or draft_info.json) existed, differed, and was overwritten — drives the data-loss WARNING. */
  diverged: boolean;
  files_written: string[];
  backups: string[];
}

export interface SyncReport {
  schema: "capcut-david/sync-timelines@1";
  ok: true;
  dry_run: boolean;
  synced: SyncGuidResult[];
  already_in_sync: Array<{ guid: string; reason: string }>;
  /** A guid whose reconciliation threw (e.g. a locked/read-only file). Isolated
   * per-guid so a single failure never aborts the others; surfaced as exit 1. */
  errors: Array<{ guid: string; message: string }>;
  root_siblings_written: string[];
  summary: { guids_total: number; guids_synced: number; files_written: number; files_skipped: number };
}

// Per-guid mirror files reconciled from the root. draft_info.json is the mirror
// CapCut reads on FIRST open of a CLI-built draft (draft_content.json only
// appears after CapCut has opened it once), so it must be reconciled too. The
// root .bak and the patch journals (mini_draft.json / patch.json) are
// deliberately EXCLUDED — see the kickoff grounding traps.
const MIRROR_FILES = ["draft_content.json", "draft_info.json", "template-2.tmp"] as const;

interface FileOutcome {
  written: boolean;
  backup: string | null;
  skippedReason: "absent" | "identical" | null;
}

/** Reconcile one mirror file to the root bytes. Backup-then-write; on a write
 * failure, best-effort remove the just-created backup so no orphan is left. */
function reconcileFile(target: string, rootBytes: string, dryRun: boolean, epoch: number): FileOutcome {
  if (!existsSync(target)) return { written: false, backup: null, skippedReason: "absent" };
  const current = readFileSync(target, "utf-8");
  if (current === rootBytes) return { written: false, backup: null, skippedReason: "identical" };
  if (dryRun) return { written: true, backup: null, skippedReason: null };

  const backup = `${target}.synced-${epoch}.bak`;
  copyFileSync(target, backup);
  try {
    writeFileSync(target, rootBytes, "utf-8");
  } catch (e) {
    // Don't leave an orphan backup behind for a write that never landed.
    try {
      rmSync(backup, { force: true });
    } catch {
      // best-effort
    }
    throw e;
  }
  return { written: true, backup, skippedReason: null };
}

export function syncTimelines(filePath: string, opts: SyncOptions = {}): SyncReport {
  const dryRun = opts.dryRun === true;
  const epoch = opts.nowMs ?? Date.now();
  const draftDir = dirname(filePath);
  const rootBytes = readFileSync(filePath, "utf-8");

  const synced: SyncGuidResult[] = [];
  const alreadyInSync: Array<{ guid: string; reason: string }> = [];
  const errors: Array<{ guid: string; message: string }> = [];
  let filesWritten = 0;
  let filesSkipped = 0;

  const guids = listTimelineDirs(draftDir);
  for (const { guid, dir } of guids) {
    // Per-guid isolation: a locked/unwritable mirror degrades to an error entry,
    // it never aborts the other guids.
    try {
      const res: SyncGuidResult = { guid, diverged: false, files_written: [], backups: [] };
      let presentFiles = 0;
      for (const rel of MIRROR_FILES) {
        const target = join(dir, rel);
        const outcome = reconcileFile(target, rootBytes, dryRun, epoch);
        if (outcome.skippedReason === "absent") continue;
        presentFiles++;
        if (outcome.written) {
          res.files_written.push(`Timelines/${guid}/${rel}`);
          if (outcome.backup) res.backups.push(`Timelines/${guid}/${rel}.synced-${epoch}.bak`);
          if (rel === "draft_content.json" || rel === "draft_info.json") res.diverged = true;
          filesWritten++;
        } else {
          filesSkipped++;
        }
      }
      if (res.files_written.length > 0) synced.push(res);
      else if (presentFiles > 0) alreadyInSync.push({ guid, reason: "byte-identical to root" });
      else alreadyInSync.push({ guid, reason: "no mirror files" });
    } catch (e) {
      errors.push({ guid, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Root siblings: refresh template-2.tmp ONLY. NEVER touch the root
  // draft_content.json.bak — it is saveDraft's private rollback of the last
  // root edit (draft.ts), and clobbering it would destroy that undo.
  const rootSiblingsWritten: string[] = [];
  const rootTmp = join(draftDir, "template-2.tmp");
  const tmpOutcome = reconcileFile(rootTmp, rootBytes, dryRun, epoch);
  if (tmpOutcome.written) {
    rootSiblingsWritten.push("template-2.tmp");
    filesWritten++;
  } else if (tmpOutcome.skippedReason === "identical") {
    filesSkipped++;
  }

  return {
    schema: "capcut-david/sync-timelines@1",
    ok: true,
    dry_run: dryRun,
    synced,
    already_in_sync: alreadyInSync,
    errors,
    root_siblings_written: rootSiblingsWritten,
    summary: {
      guids_total: guids.length,
      guids_synced: synced.length,
      files_written: filesWritten,
      files_skipped: filesSkipped,
    },
  };
}

/**
 * CLI entry. WRITE command (in WRITE_COMMANDS → CapCut-open guard fires in
 * index.ts). Emits a stderr WARNING for every guid whose draft_content.json
 * mirror was overwritten (data-loss transparency — see kickoff), then the JSON
 * report on stdout. Read-only on the root draft itself.
 */
export function cmdSyncTimelines(_draft: Draft, filePath: string, _positional: string[], flags: Flags): void {
  const report = syncTimelines(filePath, { dryRun: flags.dryRun });

  if (!flags.dryRun) {
    for (const g of report.synced) {
      if (!g.diverged) continue;
      const bak = g.backups[0] ?? "(no backup)";
      process.stderr.write(
        `WARNING ${g.guid}: divergent mirror overwritten by root (backup: ${bak}) — make sure CapCut has been closed since the draft was MODIFIED, not just since this command.\n`,
      );
    }
  }

  const draftDir = dirname(filePath);
  out(
    {
      schema: report.schema,
      ok: report.ok,
      dry_run: report.dry_run,
      project: draftDir,
      draft_file: filePath,
      synced: report.synced,
      already_in_sync: report.already_in_sync,
      root_siblings_written: report.root_siblings_written,
      summary: report.summary,
    },
    flags,
  );

  // Partial success is fine (the healthy guids were repaired), but any failed
  // guid is a tool failure → exit 1 via index.ts's CliError path.
  if (report.errors.length > 0) {
    const detail = report.errors.map((e) => `${e.guid}: ${e.message}`).join("; ");
    throw new CliError(`sync-timelines: ${report.errors.length} guid(s) failed: ${detail}`);
  }
}
