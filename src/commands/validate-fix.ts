import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Draft, loadDraft, saveDraft } from "../draft.js";
import { assertCapCutClosed } from "../utils/capcut-guard.js";
import { CliError, die, type Flags, out } from "../utils/cli.js";
import { applyGc, planGc } from "./gc.js";
import { applyInitMeta, planInitMeta } from "./init-meta.js";
import { registerDraft } from "./register.js";
import { syncTimelines } from "./sync-timelines.js";
import {
  type Finding,
  hasBlockingErrors,
  type Report,
  reportExitCode,
  runValidate,
  type ValidateOpts,
} from "./validate.js";

// validate --fix — the umbrella auto-fixer. Runs `validate`, maps each fixable
// finding to its command-backed fixer, and either PREVIEWS the aggregated plan
// (default, zero writes) or APPLIES the fixers in dependency order (--apply),
// then re-validates and reports the residual. DRY-RUN BY DEFAULT (D1): --apply
// is required to write, because --fix aggregates a DESTRUCTIVE delete (gc) across
// many findings in one pass. Design + adversarial provenance: VALIDATE-FIX-kickoff.md.

const FIXER_ORDER = ["gc", "init-meta", "register", "sync-timelines"] as const;
type FixerName = (typeof FIXER_ORDER)[number];

// Each fixer's owning finding ids. The umbrella runs a fixer iff at least one of
// its ids survives validate's --id/--skip filter (per-finding-id union: gc owns
// TWO ids, so skipping one alone must not drop gc).
const FIXER_FINDINGS: Record<FixerName, string[]> = {
  gc: ["materials.orphan_text", "materials.orphan_media"],
  "init-meta": ["meta.missing"],
  register: ["meta.unregistered"],
  "sync-timelines": ["timelines.divergence"],
};

// fixable:true but no dedicated fixer command (D2) — reported, never auto-fixed.
const EXCLUDED_FIXABLE = new Set(["duration.underrun", "duration.overrun"]);

const BLOCKED_REASON =
  "draft has error-level problems (dangling reference or duplicate material id) — fix them first; --fix refuses to run any fixer (a destructive gc on an inconsistent draft is unsafe).";

const BARE_FILE_NOTE =
  "a bare draft_content.json file was passed (not a directory): the meta/register/sync fixers need a draft directory, so only gc can run.";

export interface FixPlanEntry {
  fixer: FixerName;
  finding_ids: string[];
  action: string;
  destructive: boolean;
  blocked: boolean;
}

export interface FixPlan {
  blocked: boolean;
  plan: FixPlanEntry[];
  excluded: Array<{ finding_id: string; reason: string }>;
  unfixable: Array<{ finding_id: string; location_ref: string | null; reason: string }>;
}

function findingsForFixer(findings: Finding[], fixer: FixerName): Finding[] {
  const ids = new Set(FIXER_FINDINGS[fixer]);
  return findings.filter((f) => ids.has(f.id));
}

function buildPlanEntry(fixer: FixerName, findings: Finding[], draft: Draft, blocked: boolean): FixPlanEntry {
  const finding_ids = [...new Set(findings.map((f) => f.id))];
  if (fixer === "gc") {
    const p = planGc(draft);
    const skipped = p.skipped_cross_ref.length;
    const action = `remove ${p.total} orphan material(s)${skipped ? ` (${skipped} skipped: cross-ref)` : ""}`;
    return { fixer, finding_ids, action, destructive: true, blocked };
  }
  if (fixer === "init-meta") {
    return {
      fixer,
      finding_ids,
      action: "create the missing draft_meta_info.json sidecar",
      destructive: false,
      blocked: false,
    };
  }
  if (fixer === "register") {
    return {
      fixer,
      finding_ids,
      action: "register the draft in root_meta_info.json",
      destructive: false,
      blocked: false,
    };
  }
  return {
    fixer,
    finding_ids,
    action: `refresh ${findings.length} Timelines/ mirror(s) from root`,
    destructive: false,
    blocked: false,
  };
}

/** Pure: the aggregated fix plan derived from a validate report + the in-memory
 * draft. Reads (planGc) but never writes. `blocked` (hasBlockingErrors) flags the
 * gc entry — the umbrella refuses to APPLY when blocked, but still shows the plan. */
export function planValidateFix(report: Report, draft: Draft, blocked: boolean): FixPlan {
  const plan: FixPlanEntry[] = [];
  for (const fixer of FIXER_ORDER) {
    const fs = findingsForFixer(report.findings, fixer);
    if (fs.length === 0) continue;
    plan.push(buildPlanEntry(fixer, fs, draft, blocked));
  }
  const excluded = report.findings
    .filter((f) => EXCLUDED_FIXABLE.has(f.id))
    .map((f) => ({ finding_id: f.id, reason: "fixable but no dedicated command (excluded from --fix MVP)" }));
  const unfixable = report.findings
    .filter((f) => !f.fixable)
    .map((f) => ({ finding_id: f.id, location_ref: f.location?.ref ?? null, reason: "no fixer" }));
  return { blocked, plan, excluded, unfixable };
}

interface ResultEntry {
  fixer: FixerName;
  status: "wrote" | "skipped" | "error";
  finding_ids: string[];
  wrote: boolean;
  bak: string[];
  detail: string | null;
  error: string | null;
}

/**
 * CLI entry for `validate --fix [--apply]`. Returns the process exit code:
 *  - dry-run preview → always 0 (it previewed, it did not fail);
 *  - --apply → reportExitCode(residual) after re-validating;
 *  - --apply on a blocking-error draft → 2, zero writes (B1);
 *  - sync-timelines failure → throws CliError → exit 1 (B3).
 *
 * NOTE: orphan findings are info-severity, so reportExitCode is VACUOUS for the
 * gc path (a clean fix and a no-op both exit 0, even under --strict). The success
 * signal for gc is fix.results[].wrote, never the exit code (B7).
 */
export function cmdValidateFix(draft: Draft, filePath: string, projectInput: string, flags: Flags): number {
  // B5: --apply and --dry-run are contradictory; reject FIRST so the dryRun
  // driver below can never silently apply.
  if (flags.apply && flags.dryRun) die("--apply and --dry-run are mutually exclusive");
  const dryRun = !flags.apply;

  // Re-derive the dir-vs-file distinction (a bare file → draftDir null → the FS
  // meta/timelines checks + their fixers are gated off).
  let draftDir: string | null = null;
  try {
    if (statSync(resolve(projectInput)).isDirectory()) draftDir = resolve(projectInput);
  } catch {
    draftDir = null;
  }

  const opts: ValidateOpts = {
    strict: flags.strict,
    checkAssets: flags.checkAssets,
    checkTimelines: true, // force on: gc CREATES divergence, the umbrella must always be able to repair it
    ids: flags.ids,
    skip: flags.skip,
    projectsRoot: flags.projectsRoot,
  };

  const report = runValidate(draft, draftDir, opts);
  const blocked = hasBlockingErrors(draft);
  const note = draftDir === null ? BARE_FILE_NOTE : null;
  const fp = planValidateFix(report, draft, blocked);

  const project = draftDir ?? dirname(filePath);

  // -------- dry-run preview (default) --------
  if (dryRun) {
    out(
      {
        schema: report.schema,
        ok: true,
        project,
        draft_file: filePath,
        summary: report.summary,
        findings: report.findings,
        fix: {
          applied: false,
          blocked: fp.blocked,
          blocked_reason: fp.blocked ? BLOCKED_REASON : null,
          note,
          order: FIXER_ORDER,
          plan: fp.plan,
          unfixable: fp.unfixable,
          excluded: fp.excluded,
        },
      },
      flags,
    );
    return 0;
  }

  // -------- apply --------
  // B1: refuse the whole run on a blocking-error draft BEFORE any apply — planGc/
  // applyGc have no guard of their own (only cmdGc does, which we bypass).
  if (blocked) {
    out(
      {
        schema: report.schema,
        ok: false,
        project,
        draft_file: filePath,
        summary: report.summary,
        findings: report.findings,
        fix: { applied: false, blocked: true, blocked_reason: BLOCKED_REASON, note, results: [], residual: null },
      },
      flags,
    );
    return 2;
  }

  const emitApply = (results: ResultEntry[], residual: Report | null): void => {
    out(
      {
        schema: report.schema,
        ok: residual ? residual.ok : false,
        project,
        draft_file: filePath,
        summary: residual ? residual.summary : report.summary,
        findings: residual ? residual.findings : report.findings,
        fix: {
          applied: true,
          blocked: false,
          blocked_reason: null,
          note,
          results,
          residual: residual ? { ok: residual.ok, summary: residual.summary, findings: residual.findings } : null,
        },
      },
      flags,
    );
  };

  const selected = (fixer: FixerName): boolean => findingsForFixer(report.findings, fixer).length > 0;

  // Empty plan: nothing fixable. No write happens → skip the CapCut guard
  // (matches gc's no-op posture) and report the initial state.
  if (fp.plan.length === 0) {
    emitApply([], report);
    return reportExitCode(report);
  }

  // First write-path statement: refuse to write while CapCut is open (--force /
  // CAPCUT_DAVID_FORCE bypass). validate stays OUT of WRITE_COMMANDS so read-only
  // validate and dry-run --fix run with CapCut open.
  assertCapCutClosed(flags);

  process.stderr.write(
    `WARNING validate --fix --apply: applying ${fp.plan.length} fixer(s)${selected("gc") ? " incl. DESTRUCTIVE gc removal" : ""} — backups written. Re-validating after.\n`,
  );

  const results: ResultEntry[] = [];

  // 1. gc — mutate the in-memory draft, then the SOLE root saveDraft of the pass.
  if (selected("gc")) {
    const gcIds = findingsForFixer(report.findings, "gc").map((f) => f.id);
    const ids = [...new Set(gcIds)];
    const gcPlan = planGc(draft);
    if (gcPlan.total > 0) {
      applyGc(draft, gcPlan);
      saveDraft(filePath, draft);
      results.push({
        fixer: "gc",
        status: "wrote",
        finding_ids: ids,
        wrote: true,
        bak: [`${filePath}.bak`],
        detail: `removed ${gcPlan.total} orphan material(s)`,
        error: null,
      });
    } else {
      results.push({
        fixer: "gc",
        status: "skipped",
        finding_ids: ids,
        wrote: false,
        bak: [],
        detail: "no removable orphans (all skipped: cross-ref)",
        error: null,
      });
    }
  }

  // 2. init-meta — create the missing sidecar (must precede register).
  if (selected("init-meta") && draftDir) {
    const imPlan = planInitMeta(draft, draftDir);
    const metaPath = join(draftDir, "draft_meta_info.json");
    applyInitMeta(imPlan, metaPath);
    results.push({
      fixer: "init-meta",
      status: "wrote",
      finding_ids: ["meta.missing"],
      wrote: true,
      bak: [],
      detail: `created ${metaPath}`,
      error: null,
    });
  }

  // 3. register — index the (now-present) sidecar in root_meta_info.json.
  if (selected("register") && draftDir) {
    const rr = registerDraft({ draftDir, projectsRoot: flags.projectsRoot });
    results.push({
      fixer: "register",
      status: rr.added ? "wrote" : "skipped",
      finding_ids: ["meta.unregistered"],
      wrote: rr.added,
      bak: [],
      detail: rr.added ? `registered ${rr.draftId}` : "already registered",
      error: null,
    });
  }

  // 4. sync-timelines — STRICTLY LAST: copies the now-final root bytes into the
  // mirrors. The library returns errors[] (it does NOT throw per-guid, B3), so
  // inspect them and fail-stop to exit 1 before re-validating.
  if (selected("sync-timelines")) {
    const sr = syncTimelines(filePath, { dryRun: false });
    const baks = sr.synced.flatMap((g) => g.backups);
    if (sr.errors.length > 0) {
      const detail = sr.errors.map((e) => `${e.guid}: ${e.message}`).join("; ");
      results.push({
        fixer: "sync-timelines",
        status: "error",
        finding_ids: ["timelines.divergence"],
        wrote: false,
        bak: baks,
        detail: null,
        error: detail,
      });
      emitApply(results, null); // print what we did, then fail-stop (no re-validate after a known failure)
      throw new CliError(`validate --fix: sync-timelines failed on ${sr.errors.length} guid(s): ${detail}`);
    }
    const wrote = sr.summary.files_written > 0;
    results.push({
      fixer: "sync-timelines",
      status: wrote ? "wrote" : "skipped",
      finding_ids: ["timelines.divergence"],
      wrote,
      bak: baks,
      detail: `synced ${sr.summary.guids_synced} guid(s), ${sr.summary.files_written} file(s)`,
      error: null,
    });
  }

  // D4: re-validate from FRESH disk state so content + FS checks uniformly see
  // the committed result. Inert that loadDraft re-arms rawOriginal — nothing
  // writes after this (index.ts process.exits on return).
  const { draft: fresh } = loadDraft(filePath);
  const residual = runValidate(fresh, draftDir, opts);
  emitApply(results, residual);
  return reportExitCode(residual);
}
