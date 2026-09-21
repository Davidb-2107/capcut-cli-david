import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Draft, findDraft } from "../draft.js";
import { assertCapCutClosed } from "../utils/capcut-guard.js";
import { CliError, die, type Flags, out } from "../utils/cli.js";
import { applyInitMeta, planInitMeta } from "./init-meta.js";
import { registerDraft } from "./register.js";
import { readFileCapped } from "../utils/safe-io.js";

export function cmdInitMeta(positional: string[], flags: Flags): void {
  const input = positional[1];
  if (!input) die("Usage: capcut-david init-meta <project> [--force] [--register] [--dry-run]");

  // Own findDraft + parse (dispatched before loadDraft) so a corrupt draft is a
  // clean error, and so the dir/file distinction is unambiguous.
  const draftFile = findDraft(input);
  if (basename(draftFile) !== "draft_content.json") {
    die(
      `init-meta needs a draft_content.json (got ${basename(draftFile)}); point it at the draft dir or its draft_content.json.`,
    );
  }
  const draftDir = dirname(draftFile);

  let draft: Draft;
  try {
    draft = JSON.parse(readFileCapped(draftFile)) as Draft;
  } catch (e) {
    throw new CliError(`unreadable draft_content.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  const metaPath = join(draftDir, "draft_meta_info.json");
  const exists = existsSync(metaPath);
  if (exists && !flags.force) {
    die(
      `draft_meta_info.json already exists at ${metaPath}; init-meta only creates a MISSING sidecar. Pass --force to overwrite, or run \`register\` to index the existing one.`,
    );
  }

  const plan = planInitMeta(draft, draftDir);
  const dryRun = flags.dryRun === true;

  if (!dryRun) applyInitMeta(plan, metaPath);

  if (plan.generatedId && !dryRun) {
    process.stderr.write(
      `NOTE draft_content.json had no draft id — assigned a fresh draft_id ${plan.draftId}; register will reconcile it.\n`,
    );
  }

  let registered = false;
  let rootMetaPath: string | null = null;
  if (flags.register && !dryRun) {
    // The bare write isn't guarded (init-meta is not in WRITE_COMMANDS), but the
    // --register substep rewrites root_meta_info.json (a CapCut on-close target),
    // so guard it explicitly here.
    assertCapCutClosed(flags);
    const result = registerDraft({ draftDir, projectsRoot: flags.projectsRoot });
    registered = true;
    rootMetaPath = result.rootMetaPath;
  }

  out(
    {
      schema: "capcut-david/init-meta@1",
      ok: true,
      dry_run: dryRun,
      project: draftDir,
      draft_file: draftFile,
      meta_path: metaPath,
      draft_id: plan.draftId,
      draft_name: plan.draftName,
      wrote: !dryRun,
      registered,
      root_meta_path: rootMetaPath,
    },
    flags,
  );
}
