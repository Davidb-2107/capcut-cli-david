import { dirname } from "node:path";
import type { Draft } from "../draft.js";
import { CliError, type Flags, out } from "../utils/cli.js";
import { syncTimelines } from "./sync-timelines.js";

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
