// Tests for engine-hardening #1 — absolute-path resolution in add-audio / add-video.
//
// Footgun: cmdAddAudio/cmdAddVideo resolved paths with `audioPath.startsWith("/")`,
// which on Windows misses absolute paths (`C:\…` / `C:/…`) → the absolute path was
// concatenated onto cwd → copyFileSync ENOENT. The fix uses path.resolve() (correct
// on Win + POSIX) AND basename() for the filename (split("/").pop() returns the whole
// string when the path uses backslashes, breaking the asset copy on Windows).
//
// Contract: an absolute source must be copied into <draft>/assets/<type>/<filename>
// and the material must reference that assets path — on every platform.
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

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

// =============================================================
// #1 — absolute source path (the footgun)
//
// NOTE: the regression VALUE of the absolute-path tests is host-OS-specific.
// On POSIX an absolute path starts with "/", which the pre-fix `startsWith("/")`
// code already handled — so on Linux/macOS CI these pass with or without the fix.
// The actual bug (Windows `C:\…` not starting with "/") is exercised only when
// the suite runs on Windows, which is where the fix was watched fail→pass.
// =============================================================

test("add-video (CLI): an ABSOLUTE source path is copied into assets/video and referenced there", (t) => {
  const { filePath, dir: draftDir } = tmpDraft(FIXTURES.MINIMAL, t);
  const srcDir = scratchDir(t);
  // A genuinely absolute path on the host OS (drive-letter on Windows, /tmp on POSIX).
  const absSrc = resolve(srcDir, "clip.mp4");
  writeFileSync(absSrc, "fake-mp4-bytes");

  // No cwd trick — pass the absolute path directly (the case that ENOENT'd on Windows).
  const r = runCli(["add-video", filePath, absSrc, "0", "1s"]);
  strictEqual(r.status, 0, `expected success, stderr: ${r.stderr}`);
  ok(r.json?.ok, `expected ok JSON, got: ${r.stdout}`);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const mat = after.materials.videos.find((m) => m.id === r.json.material_id);
  ok(mat, "video material should be persisted");
  // Material must reference the copied asset under <draftDir>/assets/video/, NOT the source.
  const expected = resolve(draftDir, "assets", "video", "clip.mp4");
  strictEqual(mat.path, expected, "material.path must point into the draft's assets/video dir");
  ok(existsSync(mat.path), `copied asset should exist at ${mat.path}`);
  strictEqual(basename(mat.path), "clip.mp4");
});

test("add-audio (CLI): an ABSOLUTE source path is copied into assets/audio and referenced there", (t) => {
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
  const expected = resolve(draftDir, "assets", "audio", "voice.mp3");
  strictEqual(mat.path, expected, "material.path must point into the draft's assets/audio dir");
  ok(existsSync(mat.path), `copied asset should exist at ${mat.path}`);
});

// =============================================================
// #1 — relative input stays byte-identical (regression lock)
// =============================================================

test("add-video (CLI): a RELATIVE source path still lands under assets/video (byte-identity)", (t) => {
  const { filePath, dir: draftDir } = tmpDraft(FIXTURES.MINIMAL, t);
  const srcDir = scratchDir(t);
  writeFileSync(resolve(srcDir, "rel.mp4"), "fake-mp4-bytes");

  // Relative path resolved against cwd — the pre-fix happy path.
  const r = runCli(["add-video", filePath, "rel.mp4", "0", "1s"], { cwd: srcDir });
  strictEqual(r.status, 0, `expected success, stderr: ${r.stderr}`);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const mat = after.materials.videos.find((m) => m.id === r.json.material_id);
  ok(mat);
  // The stored material.path is destPath = resolve(assetsDir, filename) — unchanged by the fix.
  strictEqual(mat.path, resolve(draftDir, "assets", "video", "rel.mp4"));
  // Sanity: the material.path uses the platform separator and is inside the draft dir.
  ok(mat.path.startsWith(draftDir + sep) || dirname(mat.path).includes("assets"));
});
