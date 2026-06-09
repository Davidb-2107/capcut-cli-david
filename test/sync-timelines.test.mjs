// Tests for v1.9.0 `sync-timelines` — the WRITE verb that repairs the
// divergence `validate`'s read-only `timelines.divergence` detects, by copying
// the root draft_content.json (RAW bytes) into each Timelines/<guid>/ mirror.
//
// Hard invariants under test:
//  - direction is ALWAYS root -> mirror, never inverse, no mtime inference;
//  - writes RAW root bytes (never JSON.stringify / saveDraft);
//  - byte-identical target -> skip (no write, no backup): byte-identity when clean;
//  - timestamped non-clobbering backups; never touches root draft_content.json.bak
//    nor the patch journals (mini_draft.json / patch.json).
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { listTimelineDirs } from "../dist/utils/timelines.js";

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-sync-test-"));
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ===========================================================================
// listTimelineDirs — the shared Timelines/<guid> enumerator (extracted from
// mirror.ts + validate.ts so all three callers agree).
// ===========================================================================

test("listTimelineDirs: no Timelines/ folder → empty list", (t) => {
  strictEqual(listTimelineDirs(tmp(t)).length, 0);
});

test("listTimelineDirs: returns one {guid,dir} per subdirectory, skipping non-dirs", (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, "Timelines", "GUID-A"), { recursive: true });
  mkdirSync(join(dir, "Timelines", "GUID-B"), { recursive: true });
  writeFileSync(join(dir, "Timelines", ".DS_Store"), "x", "utf-8"); // not a dir → skipped

  const got = listTimelineDirs(dir).sort((a, b) => a.guid.localeCompare(b.guid));
  strictEqual(got.length, 2);
  deepStrictEqual(got.map((g) => g.guid), ["GUID-A", "GUID-B"]);
  strictEqual(got[0].dir, join(dir, "Timelines", "GUID-A"));
});

import { syncTimelines } from "../dist/commands/sync-timelines.js";

const ROOT = JSON.stringify({ id: "D1", duration: 5000000, fps: 30, canvas_config: { width: 1080, height: 1920 }, tracks: [], materials: {} }, null, 2);

// Build a draft dir: root draft_content.json + optional Timelines/<guid> mirrors.
// mirrors: { [guid]: { draft?: string|null(absent), info?: string|null, tmp?: string|null, journals?: bool } }
// rootInfo: optional root-level draft_info.json (the legacy sibling cutcli writes).
function setup(t, { root = ROOT, rootInfo, mirrors = {} } = {}) {
  const dir = tmp(t);
  const filePath = join(dir, "draft_content.json");
  writeFileSync(filePath, root, "utf-8");
  if (rootInfo !== undefined && rootInfo !== null) writeFileSync(join(dir, "draft_info.json"), rootInfo, "utf-8");
  for (const [guid, m] of Object.entries(mirrors)) {
    const g = join(dir, "Timelines", guid);
    mkdirSync(g, { recursive: true });
    if (m.draft !== undefined && m.draft !== null) writeFileSync(join(g, "draft_content.json"), m.draft, "utf-8");
    if (m.info !== undefined && m.info !== null) writeFileSync(join(g, "draft_info.json"), m.info, "utf-8");
    if (m.tmp !== undefined && m.tmp !== null) writeFileSync(join(g, "template-2.tmp"), m.tmp, "utf-8");
    if (m.journals) {
      mkdirSync(join(g, "attachment", "patch"), { recursive: true });
      writeFileSync(join(g, "attachment", "patch", "mini_draft.json"), '{"content":"OLD"}', "utf-8");
      writeFileSync(join(g, "attachment", "patch", "patch.json"), '{"content":"OLD"}', "utf-8");
    }
  }
  return { dir, filePath };
}

const NOW = 1733500000000;

test("sync: no Timelines/ folder → no-op success, nothing written", (t) => {
  const { dir, filePath } = setup(t);
  const rep = syncTimelines(filePath, { nowMs: NOW });
  strictEqual(rep.ok, true);
  strictEqual(rep.summary.guids_total, 0);
  deepStrictEqual(rep.synced, []);
  strictEqual(readdirSync(dir).includes("Timelines"), false, "must never fabricate Timelines/");
});

test("sync: a divergent mirror is overwritten with RAW root bytes + a timestamped backup", (t) => {
  const stale = JSON.stringify({ id: "D1", duration: 9999, fps: 30, canvas_config: {}, tracks: [{ segments: [{}] }], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const rep = syncTimelines(filePath, { nowMs: NOW });

  const mirror = join(dir, "Timelines", "G1", "draft_content.json");
  strictEqual(readFileSync(mirror, "utf-8"), ROOT, "mirror must equal raw root bytes");
  const bak = join(dir, "Timelines", "G1", `draft_content.json.synced-${NOW}.bak`);
  strictEqual(existsSync(bak), true, "timestamped backup must exist");
  strictEqual(readFileSync(bak, "utf-8"), stale, "backup must hold the PRE-overwrite mirror bytes");
  strictEqual(rep.synced.length, 1);
  strictEqual(rep.synced[0].diverged, true);
});

test("sync: content-only divergence (bytes differ) is overwritten — decision is byte-based, not signature", (t) => {
  // Same duration + segment count as root would give an EQUAL validate signature,
  // yet the bytes differ → sync must still overwrite (the 1.6.0 font case).
  const sameShapeDiffBytes = JSON.stringify({ id: "D1", duration: 5000000, fps: 30, canvas_config: { width: 1080, height: 1920 }, tracks: [], materials: {}, _font: "different" });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: sameShapeDiffBytes } } });
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "draft_content.json"), "utf-8"), ROOT);
});

test("sync: a byte-identical mirror is skipped — no write, no backup, mtime unchanged", (t) => {
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: ROOT } } });
  const mirror = join(dir, "Timelines", "G1", "draft_content.json");
  const mtimeBefore = statSync(mirror).mtimeMs;
  const rep = syncTimelines(filePath, { nowMs: NOW });
  strictEqual(statSync(mirror).mtimeMs, mtimeBefore, "no write on a clean mirror");
  strictEqual(existsSync(join(dir, "Timelines", "G1", `draft_content.json.synced-${NOW}.bak`)), false, "no backup on a clean mirror");
  strictEqual(rep.already_in_sync.length, 1);
  strictEqual(rep.synced.length, 0);
});

test("sync: --dry-run reports what WOULD change but writes zero bytes", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const mirror = join(dir, "Timelines", "G1", "draft_content.json");
  const mtimeBefore = statSync(mirror).mtimeMs;
  const rep = syncTimelines(filePath, { nowMs: NOW, dryRun: true });
  strictEqual(rep.dry_run, true);
  strictEqual(readFileSync(mirror, "utf-8"), stale, "dry-run must not touch the mirror");
  strictEqual(statSync(mirror).mtimeMs, mtimeBefore);
  strictEqual(existsSync(join(dir, "Timelines", "G1", `draft_content.json.synced-${NOW}.bak`)), false, "dry-run writes no backup");
  ok(rep.synced[0].files_written.includes("Timelines/G1/draft_content.json"), "dry-run lists what WOULD be written");
});

import { chmodSync } from "node:fs";

test("sync: patch journals (mini_draft.json/patch.json) are NEVER touched", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale, journals: true } } });
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "attachment", "patch", "mini_draft.json"), "utf-8"), '{"content":"OLD"}');
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "attachment", "patch", "patch.json"), "utf-8"), '{"content":"OLD"}');
});

test("sync: the root draft_content.json.bak (saveDraft's rollback) is NEVER touched; root template-2.tmp IS refreshed", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const rootBak = join(dir, "draft_content.json.bak");
  writeFileSync(rootBak, "PRIOR_ROLLBACK", "utf-8");
  writeFileSync(join(dir, "template-2.tmp"), "STALE_TMP", "utf-8");

  const rep = syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(rootBak, "utf-8"), "PRIOR_ROLLBACK", "root .bak must be left intact");
  strictEqual(readFileSync(join(dir, "template-2.tmp"), "utf-8"), ROOT, "root template-2.tmp must be refreshed to root bytes");
  ok(rep.root_siblings_written.includes("template-2.tmp"));
});

test("sync: backup goes to .synced-<epoch>.bak, never to draft_content.json.bak", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const mirrorBak = join(dir, "Timelines", "G1", "draft_content.json.bak");
  writeFileSync(mirrorBak, "MIRROR_BAK_KEEP", "utf-8");
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(mirrorBak, "utf-8"), "MIRROR_BAK_KEEP", "the mirror's own .bak is a content target, not our backup slot");
  strictEqual(existsSync(join(dir, "Timelines", "G1", `draft_content.json.synced-${NOW}.bak`)), true);
});

test("sync: multi-guid — only the divergent guid is written; the clean one is skipped", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "DIV": { draft: stale }, "CLEAN": { draft: ROOT } } });
  const rep = syncTimelines(filePath, { nowMs: NOW });
  strictEqual(rep.summary.guids_total, 2);
  strictEqual(rep.synced.length, 1);
  strictEqual(rep.synced[0].guid, "DIV");
  strictEqual(rep.already_in_sync.some((g) => g.guid === "CLEAN"), true);
});

test("sync: timestamped backups are non-clobbering — two runs keep both undos", (t) => {
  const stale1 = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale1 } } });
  syncTimelines(filePath, { nowMs: 1000 });
  // re-diverge the mirror, run again with a different epoch
  writeFileSync(join(dir, "Timelines", "G1", "draft_content.json"), JSON.stringify({ id: "Y", duration: 2, tracks: [], materials: {} }), "utf-8");
  syncTimelines(filePath, { nowMs: 2000 });
  strictEqual(existsSync(join(dir, "Timelines", "G1", "draft_content.json.synced-1000.bak")), true, "first undo survives");
  strictEqual(existsSync(join(dir, "Timelines", "G1", "draft_content.json.synced-2000.bak")), true, "second undo present");
});

test("sync: a write failure on one guid is isolated — other guids still sync, no orphan backup, errors recorded", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "BAD": { draft: stale }, "OK": { draft: stale } } });
  const badMirror = join(dir, "Timelines", "BAD", "draft_content.json");
  chmodSync(badMirror, 0o444); // read-only → writeFileSync throws after the backup copy
  try {
    const rep = syncTimelines(filePath, { nowMs: NOW });
    strictEqual(rep.errors.length, 1);
    strictEqual(rep.errors[0].guid, "BAD");
    // OK guid still got synced despite BAD failing:
    strictEqual(rep.synced.some((g) => g.guid === "OK"), true);
    strictEqual(readFileSync(join(dir, "Timelines", "OK", "draft_content.json"), "utf-8"), ROOT);
    // no orphan backup left for the failed write:
    strictEqual(existsSync(join(dir, "Timelines", "BAD", `draft_content.json.synced-${NOW}.bak`)), false, "orphan backup must be cleaned up");
  } finally {
    chmodSync(badMirror, 0o644);
  }
});

// ===========================================================================
// CLI integration (spawn) — dispatch, exit codes, --dry-run, -q, stderr warning.
// runCli defaults CAPCUT_DAVID_FORCE=1 so the (wired) guard doesn't block here.
// ===========================================================================
import { runCli } from "./helpers/spawn-cli.mjs";

test("CLI sync-timelines: divergent mirror → exit 0, ok:true, mirror repaired, stderr WARNING", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const r = runCli(["sync-timelines", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, true);
  strictEqual(r.json?.schema, "capcut-david/sync-timelines@1");
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "draft_content.json"), "utf-8"), ROOT);
  ok(/WARNING\s+G1/.test(r.stderr), `expected a divergent-overwrite warning, got: ${r.stderr}`);
});

test("CLI sync-timelines: --dry-run writes nothing, exit 0", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const r = runCli(["sync-timelines", dir, "--dry-run"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.dry_run, true);
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "draft_content.json"), "utf-8"), stale, "dry-run must not write");
  strictEqual(/WARNING/.test(r.stderr), false, "no overwrite warning on a dry-run");
});

test("CLI sync-timelines: no Timelines/ → exit 0, guids_total 0", (t) => {
  const { dir } = setup(t);
  const r = runCli(["sync-timelines", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.summary.guids_total, 0);
});

test("CLI sync-timelines: -q suppresses stdout, exit 0", (t) => {
  const { dir } = setup(t, { mirrors: { "G1": { draft: ROOT } } });
  const r = runCli(["sync-timelines", dir, "-q"]);
  strictEqual(r.status, 0);
  strictEqual(r.stdout.trim(), "");
});

test("sync: the ROOT draft_content.json is never modified (read-only source)", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { filePath } = setup(t, { mirrors: { "G1": { draft: stale } } });
  const before = readFileSync(filePath);
  const mtimeBefore = statSync(filePath).mtimeMs;
  syncTimelines(filePath, { nowMs: NOW });
  ok(readFileSync(filePath).equals(before), "root bytes changed");
  strictEqual(statSync(filePath).mtimeMs, mtimeBefore, "root mtime changed");
});

test("CLI sync-timelines: a guid write failure → exit 1 with {error}", (t) => {
  const stale = JSON.stringify({ id: "X", duration: 1, tracks: [], materials: {} });
  const { dir } = setup(t, { mirrors: { "BAD": { draft: stale } } });
  const badMirror = join(dir, "Timelines", "BAD", "draft_content.json");
  chmodSync(badMirror, 0o444);
  try {
    const r = runCli(["sync-timelines", dir]);
    strictEqual(r.status, 1);
    ok(r.errorJson?.error, `expected an {error} envelope, got: ${r.stderr}`);
  } finally {
    chmodSync(badMirror, 0o644);
  }
});

// ===========================================================================
// draft_info.json — the CapCut PRE-OPEN mirror. A CLI-built, never-opened draft
// has Timelines/<guid>/draft_info.json (video-only, written by cutcli) but NO
// draft_content.json (CapCut only materialises that on first open). saveDraft
// writes only the ROOT draft_content.json, so audio+captions never reach the
// guid's draft_info.json — the file CapCut actually reads on first open — and
// are lost. Filesystem repro proved priming the guid's draft_info.json to the
// full root content makes CapCut open with audio+text intact. sync-timelines
// must reconcile it. The ROOT draft_info.json is an inert legacy sibling and
// must stay untouched.
// ===========================================================================

// Root content carries audio+text; the stale mirror is video-only. Byte-distinct from ROOT.
const VIDEO_ONLY = JSON.stringify({ id: "D1", duration: 5000000, fps: 30, canvas_config: { width: 1080, height: 1920 }, tracks: [{ id: "vt", segments: [{}] }], materials: { videos: [{}] } }, null, 2);

test("sync: pre-open guid (draft_info.json only, no draft_content.json) → draft_info.json reconciled to root bytes", (t) => {
  const { dir, filePath } = setup(t, { rootInfo: VIDEO_ONLY, mirrors: { "G1": { info: VIDEO_ONLY } } });
  const mirrorInfo = join(dir, "Timelines", "G1", "draft_info.json");
  // pre-condition: guid has NO draft_content.json (pre-CapCut-open state)
  strictEqual(existsSync(join(dir, "Timelines", "G1", "draft_content.json")), false);

  const rep = syncTimelines(filePath, { nowMs: NOW });

  strictEqual(readFileSync(mirrorInfo, "utf-8"), ROOT, "guid draft_info.json must equal raw root bytes after sync");
  const bak = join(dir, "Timelines", "G1", `draft_info.json.synced-${NOW}.bak`);
  strictEqual(existsSync(bak), true, "timestamped backup must exist");
  strictEqual(readFileSync(bak, "utf-8"), VIDEO_ONLY, "backup must hold the PRE-overwrite (video-only) bytes");
  const g = rep.synced.find((s) => s.guid === "G1");
  ok(g, "G1 must be reported as synced");
  ok(g.files_written.includes("Timelines/G1/draft_info.json"), `draft_info.json must be listed in files_written, got: ${JSON.stringify(g.files_written)}`);
});

test("sync: the ROOT draft_info.json is NEVER modified — only the guid's is reconciled", (t) => {
  const { dir, filePath } = setup(t, { rootInfo: VIDEO_ONLY, mirrors: { "G1": { info: VIDEO_ONLY } } });
  const rootInfoPath = join(dir, "draft_info.json");
  const before = readFileSync(rootInfoPath, "utf-8");
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(rootInfoPath, "utf-8"), before, "root draft_info.json must stay untouched — CapCut does not read it as authority");
});

test("sync: post-open guid (draft_info.json AND draft_content.json) → both reconciled to root, no throw", (t) => {
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: VIDEO_ONLY, info: VIDEO_ONLY } } });
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "draft_content.json"), "utf-8"), ROOT);
  strictEqual(readFileSync(join(dir, "Timelines", "G1", "draft_info.json"), "utf-8"), ROOT);
});

test("sync: draft_info.json reconciliation is idempotent — 2nd run is a byte-identical no-op", (t) => {
  const { dir, filePath } = setup(t, { mirrors: { "G1": { info: VIDEO_ONLY } } });
  syncTimelines(filePath, { nowMs: 1000 });
  const info = join(dir, "Timelines", "G1", "draft_info.json");
  strictEqual(readFileSync(info, "utf-8"), ROOT);
  const mtimeAfter1 = statSync(info).mtimeMs;
  syncTimelines(filePath, { nowMs: 2000 });
  strictEqual(statSync(info).mtimeMs, mtimeAfter1, "2nd run must not rewrite a byte-identical draft_info.json");
  strictEqual(existsSync(join(dir, "Timelines", "G1", "draft_info.json.synced-2000.bak")), false, "no backup on an idempotent run");
});

test("sync: skip-if-absent — a guid without draft_info.json is never given one", (t) => {
  const { dir, filePath } = setup(t, { mirrors: { "G1": { draft: VIDEO_ONLY } } });
  syncTimelines(filePath, { nowMs: NOW });
  strictEqual(existsSync(join(dir, "Timelines", "G1", "draft_info.json")), false, "draft_info.json must not be fabricated");
});

test("CLI sync-timelines: a guid where only draft_info.json diverged emits a stderr WARNING", (t) => {
  const { dir } = setup(t, { mirrors: { "G1": { info: VIDEO_ONLY } } });
  const r = runCli(["sync-timelines", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(/WARNING\s+G1/.test(r.stderr), `expected a divergent-overwrite warning for draft_info.json, got: ${r.stderr}`);
});
