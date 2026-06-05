import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Draft } from "../draft.js";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { type Flags, out } from "../utils/cli.js";
import { listTimelineDirs } from "../utils/timelines.js";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  location: { kind: "segment" | "material" | "track" | "file" | "draft"; ref: string } | null;
  fixable: boolean;
  fix_hint: string | null;
}

export interface ValidateOpts {
  strict?: boolean;
  checkAssets?: boolean;
  checkTimelines?: boolean;
  ids?: string[];
  skip?: string[];
  /** Override CapCut's projects-root for the meta.* checks (defaults to
   * defaultProjectsRoot()). Mainly for tests + non-standard installs. */
  projectsRoot?: string;
}

export interface ValidateCtx {
  draft: Draft;
  draftDir: string | null;
  /** Exact ids of every material across all Array.isArray slots. */
  idSet: Set<string>;
  /** Every id reachable from a segment (material_id + extra_material_refs) or a
   * non-empty effect bind_segment_id — the union used for orphan polarity. */
  referencedIdSet: Set<string>;
  opts: ValidateOpts;
}

/** Collect the exact id of every material in every array-typed slot (~54 slots,
 * not just the 7 typed ones). Never prefix-matches. */
function collectMaterialIds(draft: Draft): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(draft.materials)) {
    if (!Array.isArray(value)) continue;
    for (const m of value) {
      if (m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string") {
        ids.add((m as { id: string }).id);
      }
    }
  }
  return ids;
}

function collectReferencedIds(draft: Draft): Set<string> {
  const refs = new Set<string>();
  if (Array.isArray(draft.tracks)) {
    for (const track of draft.tracks) {
      if (!track || !Array.isArray(track.segments)) continue;
      for (const seg of track.segments) {
        if (typeof seg.material_id === "string" && seg.material_id) refs.add(seg.material_id);
        if (Array.isArray(seg.extra_material_refs)) {
          for (const r of seg.extra_material_refs) if (typeof r === "string" && r) refs.add(r);
        }
      }
    }
  }
  const effects = draft.materials.video_effects;
  if (Array.isArray(effects)) {
    for (const e of effects) {
      const bind = (e as { bind_segment_id?: unknown }).bind_segment_id;
      if (typeof bind === "string" && bind) refs.add(bind);
    }
  }
  return refs;
}

// ===========================================================================
// CHECKS — each a pure function from context to a list of findings. Reused
// later by --fix / gc / sync-timelines.
// ===========================================================================

function checkDanglingRef(ctx: ValidateCtx): Finding[] {
  const findings: Finding[] = [];
  for (const track of ctx.draft.tracks) {
    for (const seg of track.segments) {
      const mid = seg.material_id;
      if (typeof mid !== "string" || mid === "") continue;
      if (!ctx.idSet.has(mid)) {
        findings.push({
          id: "materials.dangling_ref",
          severity: "error",
          message: `segment ${seg.id} references missing material ${mid}`,
          location: { kind: "segment", ref: seg.id },
          fixable: false,
          fix_hint: null,
        });
      }
    }
  }
  return findings;
}

/** Orphans are scoped to the typed media/text slots ONLY. Companions
 * (speeds/canvases/placeholder_infos/…) live in other slots and are
 * orphaned-by-design — flagging them would cry wolf on every draft. */
function orphansFromSlot(ctx: ValidateCtx, slot: "videos" | "audios" | "texts", id: string, kind: string): Finding[] {
  const arr = ctx.draft.materials[slot];
  if (!Array.isArray(arr)) return [];
  const findings: Finding[] = [];
  for (const m of arr) {
    const mid = (m as { id?: unknown }).id;
    if (typeof mid !== "string" || mid === "") continue;
    if (!ctx.referencedIdSet.has(mid)) {
      findings.push({
        id,
        severity: "info",
        message: `${kind} material ${mid} is referenced by no segment`,
        location: { kind: "material", ref: mid },
        fixable: true,
        fix_hint: "run `capcut-david gc <project>`",
      });
    }
  }
  return findings;
}

/** The segment-orphan ids in the three media/text slots, grouped per slot — the
 * shared definition of "orphan" that `gc` deletes against (so validate and gc
 * never drift). Reuses the SAME reachability union (collectReferencedIds); a
 * material absent from it is genuinely unreferenced (0 material->material edges,
 * verified across all fixtures). Returns ids, not Findings — so gc can tell
 * videos from audios, which the single `orphan_media` finding id cannot. */
export function collectOrphans(draft: Draft): { texts: string[]; videos: string[]; audios: string[] } {
  const referenced = collectReferencedIds(draft);
  const fromSlot = (slot: "texts" | "videos" | "audios"): string[] => {
    const arr = draft.materials[slot];
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const m of arr) {
      const mid = (m as { id?: unknown }).id;
      if (typeof mid === "string" && mid !== "" && !referenced.has(mid)) out.push(mid);
    }
    return out;
  };
  return { texts: fromSlot("texts"), videos: fromSlot("videos"), audios: fromSlot("audios") };
}

/** True when the draft has an error-severity invariant break that makes a
 * destructive gc unsafe: a dangling segment->material ref (already inconsistent)
 * or a duplicate material id (which makes "the orphan with id X" ambiguous). gc
 * refuses on either. Pure — does NOT run the full linter / FS checks. */
export function hasBlockingErrors(draft: Draft): boolean {
  const idSet = collectMaterialIds(draft);
  if (Array.isArray(draft.tracks)) {
    for (const track of draft.tracks) {
      if (!track || !Array.isArray(track.segments)) continue;
      for (const seg of track.segments) {
        const mid = seg.material_id;
        if (typeof mid === "string" && mid !== "" && !idSet.has(mid)) return true; // dangling_ref
      }
    }
  }
  const seen = new Set<string>();
  for (const value of Object.values(draft.materials)) {
    if (!Array.isArray(value)) continue;
    for (const m of value) {
      const mid = (m as { id?: unknown }).id;
      if (typeof mid !== "string" || mid === "") continue;
      if (seen.has(mid)) return true; // duplicate_id
      seen.add(mid);
    }
  }
  return false;
}

function checkOrphanText(ctx: ValidateCtx): Finding[] {
  return orphansFromSlot(ctx, "texts", "materials.orphan_text", "text");
}

function checkOrphanMedia(ctx: ValidateCtx): Finding[] {
  return [
    ...orphansFromSlot(ctx, "videos", "materials.orphan_media", "video"),
    ...orphansFromSlot(ctx, "audios", "materials.orphan_media", "audio"),
  ];
}

function checkDuplicateId(ctx: ValidateCtx): Finding[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const findings: Finding[] = [];
  for (const value of Object.values(ctx.draft.materials)) {
    if (!Array.isArray(value)) continue;
    for (const m of value) {
      const mid = (m as { id?: unknown }).id;
      if (typeof mid !== "string" || mid === "") continue;
      if (seen.has(mid) && !reported.has(mid)) {
        reported.add(mid);
        findings.push({
          id: "materials.duplicate_id",
          severity: "error",
          message: `material id ${mid} appears more than once`,
          location: { kind: "material", ref: mid },
          fixable: false,
          fix_hint: null,
        });
      }
      seen.add(mid);
    }
  }
  return findings;
}

const PRIMARY_TRACK_TYPES = new Set(["video", "audio", "text"]);

function checkZeroDuration(ctx: ValidateCtx): Finding[] {
  const findings: Finding[] = [];
  for (const track of ctx.draft.tracks) {
    const severity: Severity = PRIMARY_TRACK_TYPES.has(track.type) ? "error" : "warning";
    for (const seg of track.segments) {
      const dur = seg.target_timerange?.duration;
      if (typeof dur === "number" && dur <= 0) {
        findings.push({
          id: "segments.zero_duration",
          severity,
          message: `segment ${seg.id} on ${track.type} track has duration ${dur}`,
          location: { kind: "segment", ref: seg.id },
          fixable: false,
          fix_hint: null,
        });
      }
    }
  }
  return findings;
}

// 1 ms in µs. Wide enough to absorb frame-quantisation rounding between the
// declared draft.duration and the computed segment ends; narrow enough to still
// catch real under/overruns.
const DURATION_EPSILON_US = 1000;

function maxSegmentEnd(draft: Draft): number {
  let max = 0;
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      const tr = seg.target_timerange;
      if (tr && typeof tr.start === "number" && typeof tr.duration === "number") {
        const end = tr.start + tr.duration;
        if (end > max) max = end;
      }
    }
  }
  return max;
}

function checkDurationUnderrun(ctx: ValidateCtx): Finding[] {
  const declared = ctx.draft.duration;
  if (typeof declared !== "number") return [];
  const end = maxSegmentEnd(ctx.draft);
  if (declared < end - DURATION_EPSILON_US) {
    return [
      {
        id: "duration.underrun",
        severity: "warning",
        message: `draft.duration ${declared} is shorter than the last segment end ${end}`,
        location: { kind: "draft", ref: "duration" },
        fixable: true,
        fix_hint: `set duration to ${end}`,
      },
    ];
  }
  return [];
}

function checkDurationOverrun(ctx: ValidateCtx): Finding[] {
  const declared = ctx.draft.duration;
  if (typeof declared !== "number") return [];
  const end = maxSegmentEnd(ctx.draft);
  if (declared > end + DURATION_EPSILON_US) {
    return [
      {
        id: "duration.overrun",
        severity: "info",
        message: `draft.duration ${declared} exceeds the last segment end ${end}`,
        location: { kind: "draft", ref: "duration" },
        fixable: true,
        fix_hint: `set duration to ${end}`,
      },
    ];
  }
  return [];
}

function checkCompanionsMissing(ctx: ValidateCtx): Finding[] {
  const findings: Finding[] = [];
  for (const track of ctx.draft.tracks) {
    for (const seg of track.segments) {
      if (!Array.isArray(seg.extra_material_refs)) continue;
      for (const ref of seg.extra_material_refs) {
        if (typeof ref !== "string" || ref === "") continue;
        if (!ctx.idSet.has(ref)) {
          findings.push({
            id: "companions.missing",
            severity: "warning",
            message: `segment ${seg.id} references missing companion material ${ref}`,
            location: { kind: "segment", ref: seg.id },
            fixable: false,
            fix_hint: null,
          });
        }
      }
    }
  }
  return findings;
}

const OVERLAP_TRACK_TYPES = new Set(["video", "audio"]);

function checkSegmentsOverlap(ctx: ValidateCtx): Finding[] {
  const findings: Finding[] = [];
  for (const track of ctx.draft.tracks) {
    if (!OVERLAP_TRACK_TYPES.has(track.type)) continue;
    const spans = track.segments
      .filter((s) => s.target_timerange && typeof s.target_timerange.start === "number")
      .map((s) => ({
        id: s.id,
        start: s.target_timerange.start,
        end: s.target_timerange.start + s.target_timerange.duration,
      }))
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1];
      const cur = spans[i];
      if (cur.start < prev.end) {
        findings.push({
          id: "segments.overlap",
          severity: "warning",
          message: `segments ${prev.id} and ${cur.id} overlap on ${track.type} track ${track.id}`,
          location: { kind: "segment", ref: cur.id },
          fixable: false,
          fix_hint: null,
        });
      }
    }
  }
  return findings;
}

function checkCanvasConfigSanity(ctx: ValidateCtx): Finding[] {
  const { fps, canvas_config } = ctx.draft;
  const bad: string[] = [];
  if (typeof fps !== "number" || fps <= 0) bad.push(`fps=${fps}`);
  if (!canvas_config || typeof canvas_config.width !== "number" || canvas_config.width <= 0) {
    bad.push(`width=${canvas_config?.width}`);
  }
  if (!canvas_config || typeof canvas_config.height !== "number" || canvas_config.height <= 0) {
    bad.push(`height=${canvas_config?.height}`);
  }
  if (bad.length === 0) return [];
  return [
    {
      id: "canvas.config_sanity",
      severity: "warning",
      message: `non-positive canvas/fps config: ${bad.join(", ")}`,
      location: { kind: "draft", ref: "canvas_config" },
      fixable: false,
      fix_hint: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// FS checks — only run when ctx.draftDir is known (a directory was passed, not
// a bare file). They read disk; a missing/garbled file degrades to no finding
// (runValidate wraps every check in try/catch).
// ---------------------------------------------------------------------------

function readRootStore(ctx: ValidateCtx): Array<Record<string, unknown>> | null {
  const root = ctx.opts.projectsRoot ?? defaultProjectsRoot();
  const rootMeta = join(root, "root_meta_info.json");
  if (!existsSync(rootMeta)) return null;
  const parsed = JSON.parse(readFileSync(rootMeta, "utf-8")) as { all_draft_store?: unknown };
  return Array.isArray(parsed.all_draft_store) ? (parsed.all_draft_store as Array<Record<string, unknown>>) : [];
}

function checkMetaMissing(ctx: ValidateCtx): Finding[] {
  if (!ctx.draftDir) return [];
  if (existsSync(join(ctx.draftDir, "draft_meta_info.json"))) return [];
  return [
    {
      id: "meta.missing",
      severity: "error",
      message: `draft has no draft_meta_info.json — it will not appear in CapCut and register will fail`,
      location: { kind: "file", ref: join(ctx.draftDir, "draft_meta_info.json") },
      fixable: true,
      fix_hint: "run `capcut-david init-meta <project>`",
    },
  ];
}

function checkMetaUnregistered(ctx: ValidateCtx): Finding[] {
  if (!ctx.draftDir) return [];
  const store = readRootStore(ctx);
  if (store === null) return [];
  const dir = resolve(ctx.draftDir);
  const registered = store.some((e) => typeof e.draft_fold_path === "string" && resolve(e.draft_fold_path) === dir);
  if (registered) return [];
  return [
    {
      id: "meta.unregistered",
      severity: "warning",
      message: `draft dir is not in root_meta_info.json — CapCut will not list it`,
      location: { kind: "file", ref: dir },
      fixable: true,
      fix_hint: "run `capcut-david register <draft-dir>`",
    },
  ];
}

function checkMetaDuplicateDraftId(ctx: ValidateCtx): Finding[] {
  if (!ctx.draftDir) return [];
  const store = readRootStore(ctx);
  if (store === null) return [];
  const byId = new Map<string, Set<string>>();
  for (const e of store) {
    const id = e.draft_id;
    const fold = e.draft_fold_path;
    if (typeof id !== "string" || typeof fold !== "string") continue;
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id)?.add(resolve(fold));
  }
  const findings: Finding[] = [];
  for (const [id, folds] of byId) {
    if (folds.size > 1) {
      findings.push({
        id: "meta.duplicate_draft_id",
        severity: "warning",
        message: `draft_id ${id} is shared by ${folds.size} different folders (likely a cp -r collision)`,
        location: { kind: "draft", ref: id },
        fixable: false,
        fix_hint: null,
      });
    }
  }
  return findings;
}

function checkAssetsMissingFile(ctx: ValidateCtx): Finding[] {
  const findings: Finding[] = [];
  for (const slot of ["videos", "audios"] as const) {
    const arr = ctx.draft.materials[slot];
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      const p = (m as { path?: unknown }).path;
      // Skip empties and CapCut's own placeholder tokens; only resolvable
      // absolute paths can be checked (relative paths need draftDir context).
      if (typeof p !== "string" || p === "" || p.includes("##") || !isAbsolute(p)) continue;
      if (!existsSync(p)) {
        findings.push({
          id: "assets.missing_file",
          severity: "warning",
          message: `material ${(m as { id?: string }).id} points at a missing file: ${p}`,
          location: { kind: "material", ref: String((m as { id?: string }).id ?? "") },
          fixable: false,
          fix_hint: null,
        });
      }
    }
  }
  return findings;
}

/** Cheap structural fingerprint — never a deep-equal (CapCut's mirror differs in
 * many benign fields). Only catastrophic drift (duration / segment count) trips. */
export function draftSignature(d: { duration?: unknown; tracks?: unknown }): string {
  const duration = typeof d.duration === "number" ? d.duration : -1;
  let segs = 0;
  if (Array.isArray(d.tracks)) {
    for (const t of d.tracks) {
      if (t && Array.isArray((t as { segments?: unknown }).segments))
        segs += (t as { segments: unknown[] }).segments.length;
    }
  }
  return `${duration}|${segs}`;
}

function checkTimelinesDivergence(ctx: ValidateCtx): Finding[] {
  if (!ctx.draftDir) return [];
  const rootSig = draftSignature(ctx.draft);
  const findings: Finding[] = [];
  for (const { guid, dir } of listTimelineDirs(ctx.draftDir)) {
    const mirror = join(dir, "draft_content.json");
    if (!existsSync(mirror)) continue;
    const parsed = JSON.parse(readFileSync(mirror, "utf-8")) as { duration?: unknown; tracks?: unknown };
    const mirrorSig = draftSignature(parsed);
    if (mirrorSig !== rootSig) {
      findings.push({
        id: "timelines.divergence",
        severity: "warning",
        message: `Timelines/${guid} mirror diverges from root (sig ${mirrorSig} vs ${rootSig}) — re-patched after CapCut opened it`,
        location: { kind: "file", ref: mirror },
        fixable: true,
        fix_hint: "run `capcut-david sync-timelines <project>` (or keep CapCut closed through the CLI chain)",
      });
    }
  }
  return findings;
}

interface CheckDef {
  id: string;
  run: (ctx: ValidateCtx) => Finding[];
  /** When present and false, the check is counted as skipped (FS/opt-in gates). */
  gate?: (ctx: ValidateCtx) => boolean;
}

const hasDir = (ctx: ValidateCtx) => ctx.draftDir !== null;

export const CHECKS: CheckDef[] = [
  { id: "materials.dangling_ref", run: checkDanglingRef },
  { id: "materials.duplicate_id", run: checkDuplicateId },
  { id: "companions.missing", run: checkCompanionsMissing },
  { id: "segments.zero_duration", run: checkZeroDuration },
  { id: "duration.underrun", run: checkDurationUnderrun },
  { id: "duration.overrun", run: checkDurationOverrun },
  { id: "segments.overlap", run: checkSegmentsOverlap },
  { id: "materials.orphan_text", run: checkOrphanText },
  { id: "materials.orphan_media", run: checkOrphanMedia },
  { id: "canvas.config_sanity", run: checkCanvasConfigSanity },
  { id: "meta.missing", run: checkMetaMissing, gate: hasDir },
  { id: "meta.unregistered", run: checkMetaUnregistered, gate: hasDir },
  { id: "meta.duplicate_draft_id", run: checkMetaDuplicateDraftId, gate: hasDir },
  { id: "assets.missing_file", run: checkAssetsMissingFile, gate: (ctx) => ctx.opts.checkAssets === true },
  {
    id: "timelines.divergence",
    run: checkTimelinesDivergence,
    gate: (ctx) => ctx.draftDir !== null && ctx.opts.checkTimelines === true,
  },
];

// ===========================================================================
// runValidate — assemble findings + summary. Pure (no I/O, no process.exit).
// ===========================================================================

export interface Report {
  schema: "capcut-david/validate@1";
  ok: boolean;
  findings: Finding[];
  summary: { errors: number; warnings: number; info: number; checks_run: number; checks_skipped: number };
}

export function runValidate(draft: Draft, draftDir: string | null, opts: ValidateOpts): Report {
  const ctx: ValidateCtx = {
    draft,
    draftDir,
    idSet: collectMaterialIds(draft),
    referencedIdSet: collectReferencedIds(draft),
    opts,
  };

  const only = opts.ids?.length ? new Set(opts.ids) : null;
  const skip = opts.skip?.length ? new Set(opts.skip) : null;

  const findings: Finding[] = [];
  let checksRun = 0;
  let checksSkipped = 0;

  for (const check of CHECKS) {
    if (only && !only.has(check.id)) {
      checksSkipped++;
      continue;
    }
    if (skip?.has(check.id)) {
      checksSkipped++;
      continue;
    }
    if (check.gate && !check.gate(ctx)) {
      checksSkipped++;
      continue;
    }
    checksRun++;
    // A throwing check degrades to a diagnostic — never crashes the run.
    try {
      findings.push(...check.run(ctx));
    } catch (e) {
      findings.push({
        id: check.id,
        severity: "warning",
        message: `check ${check.id} failed: ${e instanceof Error ? e.message : String(e)}`,
        location: null,
        fixable: false,
        fix_hint: null,
      });
    }
  }

  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === "error") errors++;
    else if (f.severity === "warning") warnings++;
    else info++;
  }

  // --strict promotes warnings to the failure threshold (exit-code semantics);
  // ok mirrors that threshold so the JSON consumer and the exit code agree.
  const ok = errors === 0 && !(opts.strict && warnings > 0);

  return {
    schema: "capcut-david/validate@1",
    ok,
    findings,
    summary: { errors, warnings, info, checks_run: checksRun, checks_skipped: checksSkipped },
  };
}

/** Exit code for a run that COMPLETED (tool failures exit 1 elsewhere):
 * 0 = nothing at/above the failure threshold, 2 = something is. */
export function reportExitCode(report: Report): number {
  return report.ok ? 0 : 2;
}

interface Envelope extends Report {
  project: string;
  draft_file: string;
}

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];

function renderHuman(env: Envelope): void {
  const s = env.summary;
  console.log(`validate ${env.draft_file}`);
  console.log(
    `  ${s.errors} error, ${s.warnings} warning, ${s.info} info  (${s.checks_run} checks run, ${s.checks_skipped} skipped)`,
  );
  if (env.findings.length === 0) {
    console.log("  clean - no problems found");
    return;
  }
  for (const sev of SEVERITY_ORDER) {
    const group = env.findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    console.log(`\n[${sev}]`);
    for (const f of group) {
      console.log(`  ${f.id.padEnd(26)} ${f.message}`);
    }
  }
}

/**
 * CLI entry. Read-only: never writes a byte. Returns the process exit code
 * (0/2) — a tool failure (bad path / unparseable JSON) throws a CliError that
 * the index.ts try/catch turns into exit 1, never reaching here.
 *
 * `projectInput` is the ORIGINAL argument (dir or file). findDraft collapses
 * both to the same draft_content.json, so we re-derive the dir-vs-file
 * distinction here: a bare file → draftDir null → FS meta.* checks skip.
 */
export function cmdValidate(draft: Draft, filePath: string, projectInput: string, flags: Flags): number {
  let draftDir: string | null = null;
  try {
    if (statSync(resolve(projectInput)).isDirectory()) draftDir = resolve(projectInput);
  } catch {
    draftDir = null;
  }

  const report = runValidate(draft, draftDir, {
    strict: flags.strict,
    checkAssets: flags.checkAssets,
    checkTimelines: flags.checkTimelines,
    ids: flags.ids,
    skip: flags.skip,
    projectsRoot: flags.projectsRoot,
  });

  const envelope: Envelope = {
    schema: report.schema,
    ok: report.ok,
    project: draftDir ?? dirname(filePath),
    draft_file: filePath,
    summary: report.summary,
    findings: report.findings,
  };

  if (flags.human) renderHuman(envelope);
  else out(envelope, flags);

  return reportExitCode(report);
}
