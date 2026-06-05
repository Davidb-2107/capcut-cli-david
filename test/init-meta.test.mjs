// Tests for v1.11.0 `init-meta` — generates the missing draft_meta_info.json
// that `validate`'s meta.missing detects. POSTURE IS INVERSE of gc/sync: an
// existing sidecar is presumed authoritative (true draft_id / tm_* / cloud refs),
// so init-meta REFUSES to clobber it without --force. The dangerous test (no
// clobber) comes first.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";

import { buildDraftMetaInfo } from "../dist/utils/draft-meta.js";

// ===========================================================================
// [EXTRACTION] buildDraftMetaInfo moved verbatim out of pipeline.ts — its shape
// must be unchanged (the full ~40-field canonical sidecar). All pipeline tests
// staying green is the real byte-identity guard for psycho-build's output.
// ===========================================================================

test("buildDraftMetaInfo: canonical shape — sources opts, stamps tm_* together, full field set", () => {
  const meta = buildDraftMetaInfo({
    draftId: "DID", draftName: "MyDraft", draftFoldPath: "C:/x/MyDraft", draftRootPath: "C:/x", totalDurationUs: 5_000_000,
  });
  strictEqual(meta.draft_id, "DID");
  strictEqual(meta.draft_name, "MyDraft");
  strictEqual(meta.draft_fold_path, "C:/x/MyDraft");
  strictEqual(meta.draft_root_path, "C:/x");
  strictEqual(meta.tm_duration, 5_000_000);
  strictEqual(meta.draft_new_version, "164.0.0");
  strictEqual(meta.draft_cover, "draft_cover.jpg");
  strictEqual(meta.tm_draft_create, meta.tm_draft_modified, "create == modified (both now)");
  ok(Array.isArray(meta.draft_materials) && meta.draft_materials.length === 7, "7 draft_materials entries");
  // a sampling of the ~40 canonical fields must be present
  for (const k of ["cloud_draft_cover", "draft_enterprise_info", "draft_is_invisible", "tm_draft_cloud_entry_id", "tm_draft_removed"]) {
    ok(k in meta, `canonical field ${k} present`);
  }
});

test("buildDraftMetaInfo: EXACT canonical key set + order (verbatim-extraction guard — JSON byte order)", () => {
  // Locks the sidecar shape psycho-build emits: a dropped or reordered key
  // changes the bytes CapCut reads. (tm_draft_cloud_user_id was once dropped.)
  const meta = buildDraftMetaInfo({ draftId: "a", draftName: "b", draftFoldPath: "c", draftRootPath: "d", totalDurationUs: 1 });
  deepStrictEqual(Object.keys(meta), [
    "cloud_draft_cover", "cloud_draft_sync", "cloud_package_completed_time", "draft_cloud_capcut_purchase_info",
    "draft_cloud_last_action_download", "draft_cloud_package_type", "draft_cloud_purchase_info", "draft_cloud_template_id",
    "draft_cloud_tutorial_info", "draft_cloud_videocut_purchase_info", "draft_cover", "draft_deeplink_url",
    "draft_enterprise_info", "draft_fold_path", "draft_id", "draft_is_ae_produce", "draft_is_ai_packaging_used",
    "draft_is_ai_shorts", "draft_is_ai_translate", "draft_is_article_video_draft", "draft_is_cloud_temp_draft",
    "draft_is_from_deeplink", "draft_is_invisible", "draft_is_web_article_video", "draft_materials",
    "draft_materials_copied_info", "draft_name", "draft_need_rename_folder", "draft_new_version",
    "draft_removable_storage_device", "draft_root_path", "draft_segment_extra_info", "draft_timeline_materials_size_",
    "draft_type", "draft_web_article_video_enter_from", "tm_draft_cloud_completed", "tm_draft_cloud_entry_id",
    "tm_draft_cloud_modified", "tm_draft_cloud_parent_entry_id", "tm_draft_cloud_space_id", "tm_draft_cloud_user_id",
    "tm_draft_create", "tm_draft_modified", "tm_draft_removed", "tm_duration",
  ]);
});

import { runCli } from "./helpers/spawn-cli.mjs";

const CONTENT = (over = {}) => JSON.stringify({ id: "CID", name: "ignored", duration: 5_000_000, fps: 30, canvas_config: { width: 1080, height: 1920 }, tracks: [], materials: {}, ...over });

// dir with a draft_content.json; optionally a pre-existing meta sidecar.
function draftDir(t, { content = CONTENT(), meta } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-initmeta-test-"));
  writeFileSync(join(dir, "draft_content.json"), content, "utf-8");
  if (meta !== undefined) writeFileSync(join(dir, "draft_meta_info.json"), meta, "utf-8");
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[NO-CLOBBER] an existing draft_meta_info.json is NOT overwritten without --force", (t) => {
  const dir = draftDir(t, { meta: '{"draft_id":"REAL","tm_draft_create":12345}' });
  const metaPath = join(dir, "draft_meta_info.json");
  const before = readFileSync(metaPath);
  const mtime = statSync(metaPath).mtimeMs;
  const r = runCli(["init-meta", dir]);
  strictEqual(r.status, 1, `must refuse; stderr: ${r.stderr}`);
  ok(r.errorJson?.error && /already exists/.test(r.errorJson.error));
  ok(readFileSync(metaPath).equals(before), "sidecar bytes unchanged");
  strictEqual(statSync(metaPath).mtimeMs, mtime, "sidecar mtime unchanged");
  strictEqual(existsSync(`${metaPath}.bak`), false, "no .bak on a refusal");
});

test("[NO-CLOBBER] --force overwrites but writes a .bak of the original first", (t) => {
  const dir = draftDir(t, { meta: '{"draft_id":"REAL"}' });
  const metaPath = join(dir, "draft_meta_info.json");
  const r = runCli(["init-meta", dir, "--force"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(readFileSync(`${metaPath}.bak`, "utf-8"), '{"draft_id":"REAL"}', ".bak holds the original");
  strictEqual(JSON.parse(readFileSync(metaPath, "utf-8")).draft_id, "CID", "overwritten with the generated sidecar");
  ok(/WARNING init-meta overwrote/.test(r.stderr));
});

test("happy path: a dir without a sidecar gets a canonical draft_meta_info.json; draft_content untouched", (t) => {
  const dir = draftDir(t);
  const contentBefore = readFileSync(join(dir, "draft_content.json"));
  const r = runCli(["init-meta", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.wrote, true);
  const meta = JSON.parse(readFileSync(join(dir, "draft_meta_info.json"), "utf-8"));
  strictEqual(meta.draft_id, "CID", "draft_id sourced from draft_content.json");
  strictEqual(meta.draft_name, basename(dir), "draft_name from dir basename");
  strictEqual(meta.tm_duration, 5_000_000);
  strictEqual(meta.draft_root_path, resolve(dir, ".."), "draft_root_path = parent of draft dir");
  strictEqual(meta.draft_fold_path, resolve(dir));
  ok(readFileSync(join(dir, "draft_content.json")).equals(contentBefore), "draft_content.json must be untouched");
});

test("scope: init-meta NEVER writes draft_info.json or any other file", (t) => {
  const dir = draftDir(t);
  runCli(["init-meta", dir]);
  strictEqual(existsSync(join(dir, "draft_info.json")), false, "draft_info.json must not be written");
});

test("--dry-run: reports the plan, writes zero files", (t) => {
  const dir = draftDir(t);
  const r = runCli(["init-meta", dir, "--dry-run"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.dry_run, true);
  strictEqual(r.json?.wrote, false);
  strictEqual(r.json?.draft_id, "CID");
  strictEqual(existsSync(join(dir, "draft_meta_info.json")), false, "dry-run writes nothing");
});

test("bare file input: writing the sidecar in the containing dir", (t) => {
  const dir = draftDir(t);
  const r = runCli(["init-meta", join(dir, "draft_content.json")]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(existsSync(join(dir, "draft_meta_info.json")), true);
});

test("empty draft.id → a fresh draft_id is generated + a stderr NOTE", (t) => {
  const dir = draftDir(t, { content: CONTENT({ id: "" }) });
  const r = runCli(["init-meta", dir]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  ok(r.json?.draft_id && r.json.draft_id.length >= 8, "minted a uuid");
  ok(/NOTE .*fresh draft_id/.test(r.stderr));
});

test("garbage draft_content.json → exit 1, no sidecar written", (t) => {
  const dir = draftDir(t, { content: "{ not json" });
  const r = runCli(["init-meta", dir]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error);
  strictEqual(existsSync(join(dir, "draft_meta_info.json")), false);
});

test("--register chains register: the draft lands in root_meta_info.json", (t) => {
  const dir = draftDir(t);
  const root = mkdtempSync(join(tmpdir(), "capcut-initmeta-root-"));
  if (t.after) t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = runCli(["init-meta", dir, "--register", "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.registered, true);
  const rootMeta = JSON.parse(readFileSync(join(root, "root_meta_info.json"), "utf-8"));
  ok(rootMeta.all_draft_store.some((e) => e.draft_fold_path === resolve(dir)), "draft registered in the root index");
});
