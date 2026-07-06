// Tests for add-audio / add-video portable-path contract (v2.0.0).
//
// History: engine-hardening #1 fixed absolute-path resolution on Windows
// (`startsWith("/")` missed `C:\…`). v2.0.0 then replaced the whole
// copy-into-assets/-and-write-absolute-path scheme: an absolute material.path
// containing the draft folder name dies when CapCut duplicates/renames the
// draft (`v_slug` → `v_slug(1)`) → "Link media, couldn't find …" dialog.
//
// Contract now: the source is copied into <draft>/Resources/<matId><ext> and
// material.path is the portable token
//   ##_draftpath_placeholder_<UUID>_##\Resources\<matId><ext>
// which CapCut re-resolves relative to the draft's own folder — rename-safe.
import { test } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const TOKEN_PATH_RE = /^##_draftpath_placeholder_[0-9A-Fa-f-]+_##\\Resources\\[0-9A-Fa-f-]+\.[A-Za-z0-9]+$/;

function scratchDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cli-david-abspath-"));
  if (t && typeof t.after === "function") {
    t.after(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    });
  }
  return dir;
}

/** Assert the v2.0.0 material.path contract; returns the on-disk copy path. */
function assertTokenPath(mat, draftDir, matId, ext) {
  match(mat.path, TOKEN_PATH_RE, "material.path must be a portable placeholder token into Resources/");
  ok(mat.path.endsWith(`\\Resources\\${matId}${ext}`), `token must end with \\Resources\\${matId}${ext}: ${mat.path}`);
  // Anti-regression (the original bug): the stored path must NEVER contain the
  // draft folder name — that is exactly what broke on duplication/rename.
  ok(!mat.path.includes(basename(draftDir)), `material.path must not embed the draft folder name: ${mat.path}`);
  const onDisk = resolve(draftDir, "Resources", `${matId}${ext}`);
  ok(existsSync(onDisk), `copied asset should exist at ${onDisk}`);
  ok(!existsSync(resolve(draftDir, "assets")), "legacy assets/ dir must not be created");
  return onDisk;
}

test("add-video (CLI): an ABSOLUTE source path is copied into Resources/ and referenced by token", (t) => {
  const { filePath, dir: draftDir } = tmpDraft(FIXTURES.MINIMAL, t);
  const srcDir = scratchDir(t);
  const absSrc = resolve(srcDir, "clip.mp4");
  writeFileSync(absSrc, "fake-mp4-bytes");

  const r = runCli(["add-video", filePath, absSrc, "0", "1s"]);
  strictEqual(r.status, 0, `expected success, stderr: ${r.stderr}`);
  ok(r.json?.ok, `expected ok JSON, got: ${r.stdout}`);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const mat = after.materials.videos.find((m) => m.id === r.json.material_id);
  ok(mat, "video material should be persisted");
  assertTokenPath(mat, draftDir, r.json.material_id, ".mp4");
  strictEqual(mat.material_name, "clip.mp4", "UI name stays the human-readable source filename");
});

test("add-audio (CLI): an ABSOLUTE source path is copied into Resources/ and referenced by token", (t) => {
  const { filePath, dir: draftDir } = tmpDraft(FIXTURES.MINIMAL, t);
  const srcDir = scratchDir(t);
  const absSrc = resolve(srcDir, "voice.mp3");
  writeFileSync(absSrc, "fake-mp3-bytes");

  const r = runCli(["add-audio", filePath, absSrc, "0", "2s"]);
  strictEqual(r.status, 0, `expected success, stderr: ${r.stderr}`);
  ok(r.json?.ok, `expected ok JSON, got: ${r.stdout}`);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const mat = after.materials.audios.find((m) => m.id === r.json.material_id);
  ok(mat, "audio material should be persisted");
  assertTokenPath(mat, draftDir, r.json.material_id, ".mp3");
  strictEqual(mat.name, "voice.mp3", "UI name stays the human-readable source filename");
});

test("add-video (CLI): a RELATIVE source path also lands in Resources/ with a token path", (t) => {
  const { filePath, dir: draftDir } = tmpDraft(FIXTURES.MINIMAL, t);
  const srcDir = scratchDir(t);
  writeFileSync(resolve(srcDir, "rel.mp4"), "fake-mp4-bytes");

  // Relative path resolved against cwd.
  const r = runCli(["add-video", filePath, "rel.mp4", "0", "1s"], { cwd: srcDir });
  strictEqual(r.status, 0, `expected success, stderr: ${r.stderr}`);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const mat = after.materials.videos.find((m) => m.id === r.json.material_id);
  ok(mat);
  assertTokenPath(mat, draftDir, r.json.material_id, ".mp4");
});
