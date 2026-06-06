import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Draft, findDraft } from "../draft.js";
import { assertCapCutClosed } from "../utils/capcut-guard.js";
import { CliError, die, type Flags, out } from "../utils/cli.js";
import { buildDraftMetaInfo } from "../utils/draft-meta.js";
import { registerDraft } from "./register.js";

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
 * like saveDraft) so a forced overwrite stays recoverable. CREATE path = exactly
 * one trailing write (a read-only dir throws here with nothing half-written).
 * Extracted from cmdInitMeta so the `validate --fix` umbrella can apply init-meta
 * without re-parsing or re-emitting an envelope. */
export function applyInitMeta(plan: InitMetaPlan, metaPath: string): void {
  if (existsSync(metaPath)) {
    copyFileSync(metaPath, `${metaPath}.bak`);
    process.stderr.write(`WARNING init-meta overwrote an existing draft_meta_info.json (backup: ${metaPath}.bak).\n`);
  }
  writeFileSync(metaPath, JSON.stringify(plan.meta, null, 0), "utf-8");
}

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
    draft = JSON.parse(readFileSync(draftFile, "utf-8")) as Draft;
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
