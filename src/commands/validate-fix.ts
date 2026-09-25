import type { Draft } from "../draft.js";
import { planGc } from "./gc.js";
import type { Finding, Report } from "./validate.js";

export const FIXER_ORDER = ["gc", "init-meta", "register", "sync-timelines"] as const;
export type FixerName = (typeof FIXER_ORDER)[number];

// Each fixer's owning finding ids. The umbrella runs a fixer iff at least one of
// its ids survives validate's --id/--skip filter (per-finding-id union: gc owns
// TWO ids, so skipping one alone must not drop gc).
const FIXER_FINDINGS: Record<FixerName, string[]> = {
  gc: ["materials.orphan_text", "materials.orphan_media"],
  "init-meta": ["meta.missing"],
  register: ["meta.unregistered"],
  "sync-timelines": ["timelines.identity", "timelines.divergence"],
};

// fixable:true but no dedicated fixer command (D2) — reported, never auto-fixed.
const EXCLUDED_FIXABLE = new Set(["duration.underrun", "duration.overrun"]);

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

export function findingsForFixer(findings: Finding[], fixer: FixerName): Finding[] {
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
