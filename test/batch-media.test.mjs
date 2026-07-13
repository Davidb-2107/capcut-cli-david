// Tests for --batch modes on add-video / add-audio / add-keyframe (v2.1.0).
// Contract: all-or-nothing, ONE save, ids in item order, batch ≡ N× unitary.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, match } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { initDraft, addVideo, addAudio } from "../dist/commands/create.js";
import { loadDraft, saveDraft } from "../dist/draft.js";
import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-batch-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  return dir;
}

/** Fresh draft on disk + two tiny media files; returns absolute paths. */
function makeDraft(t) {
  const base = scratch(t);
  const templateDir = join(base, "template");
  const draftsDir = join(base, "drafts");
  mkdirSync(templateDir, { recursive: true });
  copyFileSync(fixturePath(FIXTURES.MINIMAL), resolve(templateDir, "draft_content.json"));
  const { filePath, draftPath } = initDraft({ name: "batch-test", templateDir, draftsDir });
  const clip = resolve(base, "clip.mp4");
  const still = resolve(base, "still.png");
  writeFileSync(clip, "fake-mp4");
  writeFileSync(still, "fake-png");
  return { filePath, draftPath, clip, still, base };
}

function writeItems(base, name, items) {
  const p = resolve(base, name);
  writeFileSync(p, JSON.stringify(items));
  return p;
}

// ---------- add-video --batch ----------

test("add-video --batch: ordered ids, photo/video mix, volume, ONE track", (t) => {
  const { filePath, clip, still, base } = makeDraft(t);
  const items = writeItems(base, "videos.json", [
    { path: clip, start: 0, duration: 2_000_000, width: 1080, height: 1920, volume: 0 },
    { path: still, start: 2_000_000, duration: 3_000_000, width: 1080, height: 1920, volume: 0 },
  ]);
  const r = runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 0, r.stderr);
  const outJson = JSON.parse(r.stdout);
  strictEqual(outJson.ok, true);
  strictEqual(outJson.count, 2);
  strictEqual(outJson.segment_ids.length, 2);
  const { draft } = loadDraft(filePath);
  const track = draft.tracks.find((tr) => tr.type === "video");
  // order preserved: segment ids on the track match output order
  deepStrictEqual(track.segments.map((s) => s.id), outJson.segment_ids);
  strictEqual(track.segments[0].volume, 0);
  // photo detection by extension (existing addVideo behavior, exercised via batch)
  const stillMat = draft.materials.videos.find((m) => m.id === outJson.material_ids[1]);
  strictEqual(stillMat.type, "photo");
});

test("add-video --batch: all-or-nothing — invalid item 2 leaves draft untouched", (t) => {
  const { filePath, clip, base } = makeDraft(t);
  const before = readFileSync(filePath, "utf-8");
  const items = writeItems(base, "bad.json", [
    { path: clip, start: 0, duration: 1_000_000 },
    { path: resolve(base, "missing.mp4"), start: 1_000_000, duration: 1_000_000 },
  ]);
  const r = runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 1);
  match(r.stderr, /item 2/);
  strictEqual(readFileSync(filePath, "utf-8"), before, "draft mutated despite invalid batch");
});

test("add-video --batch: mutually exclusive with positional file", (t) => {
  const { filePath, clip, base } = makeDraft(t);
  const items = writeItems(base, "one.json", [{ path: clip, start: 0, duration: 1_000_000 }]);
  const r = runCli(["add-video", filePath, clip, "0", "1s", "--batch", `@${items}`]);
  strictEqual(r.status, 1);
  match(r.stderr, /--batch cannot be combined/);
});

test("add-video --batch: empty array dies", (t) => {
  const { filePath, base } = makeDraft(t);
  const items = writeItems(base, "empty.json", []);
  const r = runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 1);
  match(r.stderr, /empty/);
});

test("oracle: batch of 2 ≡ 2 unitary addVideo calls (modulo uuids)", (t) => {
  const a = makeDraft(t);
  const b = makeDraft(t);
  // A: batch via CLI
  const items = writeItems(a.base, "v.json", [
    { path: a.clip, start: 0, duration: 2_000_000, volume: 0 },
    { path: a.still, start: 2_000_000, duration: 1_000_000, volume: 0 },
  ]);
  const r = runCli(["add-video", a.filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 0, r.stderr);
  // B: unitary via library (same params)
  const { draft: draftB } = loadDraft(b.filePath);
  addVideo(draftB, b.filePath, { path: b.clip, start: 0, duration: 2_000_000, volume: 0 });
  addVideo(draftB, b.filePath, { path: b.still, start: 2_000_000, duration: 1_000_000, volume: 0 });
  saveDraft(b.filePath, draftB);
  // canonicalize: strip uuids + machine tmp-dir names, then compare
  const canon = (fp) =>
    JSON.stringify(JSON.parse(readFileSync(fp, "utf-8")))
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
      .replace(/capcut-batch-[^"\\/]+/g, "TMP");
  strictEqual(canon(a.filePath), canon(b.filePath));
});

// ---------- add-audio --batch ----------

test("add-audio --batch: ordered ids + volume per item", (t) => {
  const { filePath, base } = makeDraft(t);
  const sfx1 = resolve(base, "a.mp3");
  writeFileSync(sfx1, "x");
  const sfx2 = resolve(base, "b.mp3");
  writeFileSync(sfx2, "y");
  const items = writeItems(base, "audios.json", [
    { path: sfx1, start: 0, duration: 500_000, volume: 0.8 },
    { path: sfx2, start: 500_000, duration: 500_000, volume: 0.3 },
  ]);
  const r = runCli(["add-audio", filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 0, r.stderr);
  const outJson = JSON.parse(r.stdout);
  strictEqual(outJson.ok, true);
  strictEqual(outJson.count, 2);
  const { draft } = loadDraft(filePath);
  const track = draft.tracks.find((tr) => tr.type === "audio");
  deepStrictEqual(track.segments.map((s) => s.id), outJson.segment_ids);
  strictEqual(track.segments[0].volume, 0.8);
  strictEqual(track.segments[1].volume, 0.3);
});

test("add-audio --batch: all-or-nothing on missing file", (t) => {
  const { filePath, base } = makeDraft(t);
  const before = readFileSync(filePath, "utf-8");
  const items = writeItems(base, "badaudio.json", [
    { path: resolve(base, "nope.mp3"), start: 0, duration: 100_000 },
  ]);
  const r = runCli(["add-audio", filePath, "--batch", `@${items}`]);
  strictEqual(r.status, 1);
  strictEqual(readFileSync(filePath, "utf-8"), before);
});
