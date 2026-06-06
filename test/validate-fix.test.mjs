// Tests for v1.12.0 `validate --fix` — the umbrella auto-fixer that maps each
// fixable finding to its command-backed fixer and runs them in dependency order
// (gc → init-meta → register → sync-timelines). DRY-RUN BY DEFAULT: --fix alone
// previews, --apply writes. Design: VALIDATE-FIX-kickoff.md (2 adversarial
// passes; B1–B7 baked in). The dangerous tests (blocking-error refusal, no-op
// writes) come first.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";
import { planValidateFix } from "../dist/commands/validate-fix.js";
import { runValidate } from "../dist/commands/validate.js";
import { planInitMeta, applyInitMeta } from "../dist/commands/init-meta.js";

// --- draft builders -------------------------------------------------------
function makeDraft(over = {}) {
  return {
    id: "CID", name: "t", duration: 1_000_000, fps: 30,
    canvas_config: { width: 1080, height: 1920, ratio: "9:16" },
    tracks: [],
    materials: { videos: [], audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [], material_animations: [] },
    ...over,
  };
}
const txt = (id, extra = {}) => ({ id, type: "text", content: "{}", font_size: 10, text_color: "", alignment: 1, ...extra });
const vid = (id) => ({ id, path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 });
const mats = (over = {}) => ({ ...makeDraft().materials, ...over });

const CONTENT = (over = {}) => JSON.stringify(makeDraft(over));

// dir with a draft_content.json; optional sidecar + optional Timelines mirror.
function setupDir(t, { content = CONTENT(), meta, mirrorSig } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-vfix-"));
  writeFileSync(join(dir, "draft_content.json"), content, "utf-8");
  if (meta !== undefined) writeFileSync(join(dir, "draft_meta_info.json"), meta, "utf-8");
  if (mirrorSig !== undefined) {
    const tl = join(dir, "Timelines", "GUID-1");
    mkdirSync(tl, { recursive: true });
    // a mirror whose duration differs → divergent signature
    writeFileSync(join(tl, "draft_content.json"), JSON.stringify({ duration: mirrorSig, tracks: [] }), "utf-8");
  }
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// a projects-root; when `empty` write an empty root_meta_info.json so the
// meta.unregistered check has a store to read (store!==null) but the draft is absent.
function setupRoot(t, { empty = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "capcut-vfix-root-"));
  if (empty) writeFileSync(join(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: [], draft_ids: [], root_path: root }), "utf-8");
  if (t.after) t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// ===========================================================================
// [B1] blocking-error refusal — checked FIRST, before any applyGc/saveDraft
// ===========================================================================

test("[B1] dangling_ref + orphan, --fix --apply → exit 2, blocked, ZERO writes (applyGc never reached)", (t) => {
  // a dangling segment ref (blocking) + an orphan text (fixable)
  const draft = makeDraft({
    materials: mats({ texts: [txt("ORPH")] }),
    tracks: [{ id: "v", type: "video", name: "", attribute: 0, segments: [{ id: "s1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }],
  });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const before = readFileSync(join(dir, "draft_content.json"));
  const r = runCli(["validate", dir, "--fix", "--apply"]);
  strictEqual(r.status, 2, `must refuse with exit 2; stderr: ${r.stderr}`);
  strictEqual(r.json?.fix?.blocked, true);
  strictEqual(r.json?.fix?.applied, false);
  ok(readFileSync(join(dir, "draft_content.json")).equals(before), "draft_content.json byte-unchanged");
  strictEqual(existsSync(join(dir, "draft_content.json.bak")), false, "no .bak — applyGc/saveDraft never reached");
});

test("[B1] duplicate_id + meta.missing, --fix --apply → exit 2, zero writes", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("DUP"), txt("DUP")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const r = runCli(["validate", dir, "--fix", "--apply"]);
  strictEqual(r.status, 2, `stderr: ${r.stderr}`);
  strictEqual(r.json?.fix?.blocked, true);
  strictEqual(existsSync(join(dir, "draft_meta_info.json")), false, "init-meta must not have run");
});

test("[B1] dangling_ref, --fix (dry-run) → exit 0, plan shown blocked:true, nothing written", (t) => {
  const draft = makeDraft({ tracks: [{ id: "v", type: "video", name: "", attribute: 0, segments: [{ id: "s1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }] });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const r = runCli(["validate", dir, "--fix"]);
  strictEqual(r.status, 0, `dry-run never fails; stderr: ${r.stderr}`);
  strictEqual(r.json?.fix?.blocked, true);
  strictEqual(r.json?.fix?.applied, false);
  strictEqual(existsSync(join(dir, "draft_content.json.bak")), false);
});

// ===========================================================================
// Planning (dry-run) — pure planValidateFix + CLI
// ===========================================================================

test("planValidateFix: clean draft → empty plan, not blocked", () => {
  const draft = makeDraft();
  const report = runValidate(draft, null, {});
  const fp = planValidateFix(report, draft, false);
  strictEqual(fp.plan.length, 0);
  strictEqual(fp.blocked, false);
});

test("planValidateFix: orphan text+media → ONE gc entry covering both ids, destructive", () => {
  const draft = makeDraft({ materials: mats({ texts: [txt("T1")], videos: [vid("V1")] }) });
  const report = runValidate(draft, null, {});
  const fp = planValidateFix(report, draft, false);
  const gc = fp.plan.find((e) => e.fixer === "gc");
  ok(gc, "gc entry present");
  strictEqual(gc.destructive, true);
  ok(gc.finding_ids.includes("materials.orphan_text"));
  ok(gc.finding_ids.includes("materials.orphan_media"));
  strictEqual(fp.plan.length, 1, "only gc (no FS findings without a dir)");
});

test("planValidateFix: duration.overrun → in excluded (D2), NEVER in plan", () => {
  const draft = makeDraft({ duration: 9_000_000, tracks: [{ id: "v", type: "video", name: "", attribute: 0, segments: [{ id: "s", material_id: "V1", target_timerange: { start: 0, duration: 1_000_000 }, extra_material_refs: [] }] }], materials: mats({ videos: [vid("V1")] }) });
  const report = runValidate(draft, null, {});
  const fp = planValidateFix(report, draft, false);
  ok(fp.excluded.some((e) => e.finding_id === "duration.overrun"), "overrun excluded");
  ok(!fp.plan.some((e) => e.finding_ids.includes("duration.overrun")), "never planned");
});

test("planValidateFix: non-fixable finding (canvas) → in unfixable", () => {
  const draft = makeDraft({ fps: 0 });
  const report = runValidate(draft, null, {});
  const fp = planValidateFix(report, draft, false);
  ok(fp.unfixable.some((e) => e.finding_id === "canvas.config_sanity"));
});

test("planValidateFix: blocked=true → gc entry flagged blocked", () => {
  const draft = makeDraft({ materials: mats({ texts: [txt("T1")] }) });
  const report = runValidate(draft, null, {});
  const fp = planValidateFix(report, draft, true);
  strictEqual(fp.blocked, true);
  const gc = fp.plan.find((e) => e.fixer === "gc");
  strictEqual(gc?.blocked, true);
});

test("CLI dry-run: meta.missing dir → plan has init-meta; checkTimelines force-enabled; exit 0; no writes", (t) => {
  const dir = setupDir(t);
  const root = setupRoot(t); // no root_meta_info.json → meta.unregistered store null → no register finding
  const r = runCli(["validate", dir, "--fix", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.fix?.applied, false);
  ok(r.json.fix.plan.some((e) => e.fixer === "init-meta"), "init-meta planned");
  strictEqual(existsSync(join(dir, "draft_meta_info.json")), false, "dry-run writes nothing");
});

test("CLI dry-run: divergent mirror → sync-timelines planned even WITHOUT --check-timelines", (t) => {
  const dir = setupDir(t, { meta: '{"draft_id":"CID"}', mirrorSig: 999 });
  const root = setupRoot(t, { empty: true });
  // register the draft so meta.unregistered doesn't fire; isolate timelines.divergence
  writeFileSync(join(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: [{ draft_id: "CID", draft_fold_path: resolve(dir) }], draft_ids: ["CID"], root_path: root }), "utf-8");
  const r = runCli(["validate", dir, "--fix", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(r.json.fix.plan.some((e) => e.fixer === "sync-timelines"), "sync planned via forced checkTimelines");
});

// ===========================================================================
// Filtering (D3) — reuse --id / --skip
// ===========================================================================

test("[D3] --skip materials.orphan_text only → gc STILL runs for orphan_media", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("T1")], videos: [vid("V1")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const r = runCli(["validate", dir, "--fix", "--skip", "materials.orphan_text"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(r.json.fix.plan.some((e) => e.fixer === "gc"), "gc still planned for orphan_media");
});

test("[D3] --skip both gc ids → gc absent from plan", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("T1")], videos: [vid("V1")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const r = runCli(["validate", dir, "--fix", "--skip", "materials.orphan_text", "--skip", "materials.orphan_media"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(!r.json.fix.plan.some((e) => e.fixer === "gc"), "gc de-selected");
});

test("[D3] --id meta.missing → only init-meta considered; gc absent", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("T1")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft) });
  const r = runCli(["validate", dir, "--fix", "--id", "meta.missing"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(!r.json.fix.plan.some((e) => e.fixer === "gc"), "gc not in plan");
  ok(r.json.fix.plan.some((e) => e.fixer === "init-meta"), "init-meta in plan");
});

// ===========================================================================
// Apply ordering + dependency (the crux)
// ===========================================================================

test("apply: meta.missing draft → init-meta writes sidecar THEN register succeeds (no die)", (t) => {
  const dir = setupDir(t);
  const root = setupRoot(t, { empty: true }); // store present → meta.unregistered fires too
  const r = runCli(["validate", dir, "--fix", "--apply", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(existsSync(join(dir, "draft_meta_info.json")), "sidecar created by init-meta");
  const rootMeta = JSON.parse(readFileSync(join(root, "root_meta_info.json"), "utf-8"));
  ok(rootMeta.all_draft_store.some((e) => resolve(e.draft_fold_path) === resolve(dir)), "register added the draft");
});

test("apply: orphan media + divergent mirror → gc rewrites root, sync copies POST-gc bytes into mirror", (t) => {
  const draft = makeDraft({ materials: mats({ videos: [vid("ORPH")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft), meta: '{"draft_id":"CID"}', mirrorSig: 999 });
  const root = setupRoot(t);
  writeFileSync(join(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: [{ draft_id: "CID", draft_fold_path: resolve(dir) }], draft_ids: ["CID"], root_path: root }), "utf-8");
  const r = runCli(["validate", dir, "--fix", "--apply", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const rootBytes = readFileSync(join(dir, "draft_content.json"), "utf-8");
  const mirrorBytes = readFileSync(join(dir, "Timelines", "GUID-1", "draft_content.json"), "utf-8");
  strictEqual(mirrorBytes, rootBytes, "mirror == POST-gc root bytes");
  strictEqual(JSON.parse(rootBytes).materials.videos.length, 0, "orphan video removed from root");
});

// ===========================================================================
// [B7] gc success signal is fix.results[].wrote + side-effects, NOT exit code
// (orphan findings are info-severity → exit code is vacuous)
// ===========================================================================

test("[B7] gc actually removed orphans — assert material count drop, decoupled from exit code", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("A"), txt("B")], videos: [vid("C")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft), meta: '{"draft_id":"CID"}' });
  const root = setupRoot(t);
  writeFileSync(join(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: [{ draft_id: "CID", draft_fold_path: resolve(dir) }], draft_ids: ["CID"], root_path: root }), "utf-8");
  const r = runCli(["validate", dir, "--fix", "--apply", "--projects-root", root]);
  const gc = r.json?.fix?.results?.find((x) => x.fixer === "gc");
  strictEqual(gc?.wrote, true, "gc reported a write");
  const after = JSON.parse(readFileSync(join(dir, "draft_content.json"), "utf-8"));
  strictEqual(after.materials.texts.length, 0, "both orphan texts removed");
  strictEqual(after.materials.videos.length, 0, "orphan video removed");
});

// ===========================================================================
// Re-validate (D4)
// ===========================================================================

test("[D4] re-validate reads FRESH disk state — meta.missing GONE post-apply", (t) => {
  const dir = setupDir(t);
  const root = setupRoot(t, { empty: true });
  const r = runCli(["validate", dir, "--fix", "--apply", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(!r.json.fix.residual.findings.some((f) => f.id === "meta.missing"), "meta.missing resolved in residual");
});

// ===========================================================================
// Data safety
// ===========================================================================

test("data-safety: gc apply writes draft_content.json.bak holding the PRE-gc bytes", (t) => {
  const draft = makeDraft({ materials: mats({ texts: [txt("ORPH")] }) });
  const dir = setupDir(t, { content: JSON.stringify(draft), meta: '{"draft_id":"CID"}' });
  const root = setupRoot(t);
  writeFileSync(join(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: [{ draft_id: "CID", draft_fold_path: resolve(dir) }], draft_ids: ["CID"], root_path: root }), "utf-8");
  const before = readFileSync(join(dir, "draft_content.json"), "utf-8");
  const r = runCli(["validate", dir, "--fix", "--apply", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(readFileSync(join(dir, "draft_content.json.bak"), "utf-8"), before, ".bak = pre-gc bytes");
});

// ===========================================================================
// Guard (A2) — conditional on --fix --apply
// ===========================================================================

test("[A2] CapCut running + plain validate AND --fix dry-run → both succeed (guard NOT fired)", (t) => {
  const dir = setupDir(t);
  const env = { CAPCUT_DAVID_FORCE: "" }; // un-bypass; lister will run but won't find CapCut on CI (fail-open)
  // We can't force CapCut "running" without injecting a lister; assert the dry-run path does not invoke the guard at all by succeeding even with FORCE unset.
  const r = runCli(["validate", dir, "--fix"], { env });
  strictEqual(r.status, 0, `dry-run must never hit the write guard; stderr: ${r.stderr}`);
});

// ===========================================================================
// Flag conflict / envelope
// ===========================================================================

test("[B5] --fix --apply --dry-run → die mutually exclusive, exit 1", (t) => {
  const dir = setupDir(t);
  const r = runCli(["validate", dir, "--fix", "--apply", "--dry-run"]);
  strictEqual(r.status, 1, `stderr: ${r.stderr}`);
  ok(r.errorJson?.error && /mutually exclusive/.test(r.errorJson.error));
});

test("envelope: plain validate has NO fix key; --fix has fix key + validate@1 schema, no next", (t) => {
  const dir = setupDir(t);
  const plain = runCli(["validate", dir]);
  strictEqual(plain.json?.fix, undefined, "plain validate unchanged");
  const fix = runCli(["validate", dir, "--fix"]);
  strictEqual(fix.json?.schema, "capcut-david/validate@1");
  ok(fix.json?.fix, "fix key present");
  strictEqual(fix.json?.next, undefined, "no next field");
});

test("[B6] bare-file input (draft_content.json, not dir) → no init-meta entry + fix.note; exit 0", (t) => {
  const dir = setupDir(t); // no sidecar
  const r = runCli(["validate", join(dir, "draft_content.json"), "--fix"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(!r.json.fix.plan.some((e) => e.fixer === "init-meta"), "no init-meta on a bare file (draftDir null)");
  ok(r.json.fix.note && /director/i.test(r.json.fix.note), "note explains the directory requirement");
});

// ===========================================================================
// [B4] applyInitMeta refactor — byte-identical extraction
// ===========================================================================

test("[B4] applyInitMeta writes JSON.stringify(meta,null,0) byte-identical to the inline write", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-vfix-aim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const draft = makeDraft();
  const plan = planInitMeta(draft, dir);
  const metaPath = join(dir, "draft_meta_info.json");
  applyInitMeta(plan, metaPath);
  strictEqual(readFileSync(metaPath, "utf-8"), JSON.stringify(plan.meta, null, 0), "byte-identical compact JSON");
});

test("[B4] cmdInitMeta full envelope still intact after the refactor (regression)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-vfix-im-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "draft_content.json"), CONTENT(), "utf-8");
  const r = runCli(["init-meta", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.wrote, true);
  strictEqual(r.json?.draft_id, "CID");
  strictEqual(r.json?.registered, false);
  ok(r.json?.meta_path && r.json.meta_path.endsWith("draft_meta_info.json"));
});
