import { dirname } from "node:path";
import { type Draft, saveDraft } from "../draft.js";
import { CliError, type Flags, out } from "../utils/cli.js";
import { applyGc, planGc } from "./gc.js";
import { hasBlockingErrors } from "./validate.js";

export function cmdGc(draft: Draft, filePath: string, _positional: string[], flags: Flags): void {
  // Refuse on an already-broken draft: a dangling ref means it's inconsistent,
  // a duplicate id makes "the orphan with id X" ambiguous.
  if (hasBlockingErrors(draft)) {
    throw new CliError(
      "gc refuses: draft has error-level problems (dangling reference or duplicate material id). Run `capcut-david validate` and fix them first.",
    );
  }

  const plan = planGc(draft);
  const wrote = plan.total > 0 && !flags.dryRun;

  // No-op MUST NOT write: keep saveDraft's single .bak rollback + mtime intact.
  if (wrote) {
    applyGc(draft, plan);
    saveDraft(filePath, draft);
    const ids = [...plan.texts, ...plan.videos, ...plan.audios].slice(0, 5).join(", ");
    process.stderr.write(
      `WARNING gc removed ${plan.total} orphan material(s) [${ids}${plan.total > 5 ? ", …" : ""}] — backup at ${filePath}.bak. Run \`capcut-david sync-timelines\` afterwards (the root now diverges from any Timelines/ mirrors).\n`,
    );
  }

  out(
    {
      schema: "capcut-david/gc@1",
      ok: true,
      dry_run: flags.dryRun === true,
      project: dirname(filePath),
      draft_file: filePath,
      removed: { texts: plan.texts, videos: plan.videos, audios: plan.audios },
      skipped_cross_ref: plan.skipped_cross_ref,
      summary: {
        orphan_text: plan.texts.length,
        orphan_media: plan.videos.length + plan.audios.length,
        removed_total: plan.total,
        wrote,
      },
    },
    flags,
  );
}
