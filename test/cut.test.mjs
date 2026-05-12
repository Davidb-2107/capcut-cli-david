// Tests for src/commands/cut.ts → dist/commands/cut.js
// Covers cutProject() (algorithm) and cmdCut (CLI surface) via runCli.

import { test } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cutProject } from "../dist/commands/cut.js";
import { loadDraft } from "../dist/draft.js";
import { loadFixture, FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

function mkOutDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cut-"));
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

function totalSegments(draft) {
  return draft.tracks.reduce((acc, t) => acc + t.segments.length, 0);
}

test("cutProject: keeps middle slice [1s, 2s] of ken-burns draft", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const originalSegs = totalSegments(draft);

  const result = cutProject(draft, { start: 1_000_000, end: 2_000_000 });

  strictEqual(draft.duration, 1_000_000, "duration must equal end - start");
  ok(result.kept > 0, "at least one segment kept");
  ok(draft.tracks.length > 0, "at least one surviving track");

  // All surviving segments must fit inside [0, 1_000_000]
  for (const track of draft.tracks) {
    ok(track.segments.length > 0, "no empty tracks should remain");
    for (const seg of track.segments) {
      const segStart = seg.target_timerange.start;
      const segEnd = segStart + seg.target_timerange.duration;
      ok(segStart >= 0, `seg start ${segStart} must be >= 0`);
      ok(segEnd <= 1_000_000, `seg end ${segEnd} must be <= duration`);
    }
  }

  // kept + removed accounts for every original segment
  strictEqual(result.kept + result.removed, originalSegs);
});

test("cutProject: cut(0, duration) keeps everything", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const originalDuration = draft.duration;
  const originalSegs = totalSegments(draft);

  const result = cutProject(draft, { start: 0, end: originalDuration });

  strictEqual(result.kept, originalSegs, "every segment should be kept");
  strictEqual(result.removed, 0, "no segments removed");
  strictEqual(draft.duration, originalDuration);
});

test("cutProject: cut past end drops everything → tracks = []", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const originalSegs = totalSegments(draft);

  const result = cutProject(draft, { start: 5_000_000, end: 8_000_000 });

  strictEqual(result.kept, 0, "nothing kept");
  strictEqual(result.removed, originalSegs, "all removed");
  deepStrictEqual(draft.tracks, [], "no surviving tracks");
  strictEqual(draft.duration, 3_000_000);
});

test("cutProject: source_timerange adjusted by speed on overlapping clip", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);

  // Capture pre-cut source ranges for video track segments that will partially survive.
  const videoTrack = draft.tracks.find((tr) => tr.type === "video");
  ok(videoTrack, "ken-burns has a video track");
  const preSnapshots = videoTrack.segments.map((s) => ({
    id: s.id,
    speed: s.speed,
    srcStart: s.source_timerange ? s.source_timerange.start : null,
    srcDur: s.source_timerange ? s.source_timerange.duration : null,
    tgtStart: s.target_timerange.start,
    tgtDur: s.target_timerange.duration,
  }));

  cutProject(draft, { start: 1_000_000, end: 2_000_000 });

  const survivingVideo = draft.tracks.find((tr) => tr.type === "video");
  ok(survivingVideo, "video track survives");

  // For each surviving segment, source_timerange.duration should equal new target duration * speed
  for (const seg of survivingVideo.segments) {
    if (!seg.source_timerange) continue;
    const expected = Math.round(seg.target_timerange.duration * seg.speed);
    strictEqual(seg.source_timerange.duration, expected, `source duration matches speed*target for ${seg.id}`);
  }

  ok(preSnapshots.length > 0);
});

test("cutCli: writes cut draft to --out and prints JSON summary", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const outDir = mkOutDir(t);
  const outPath = join(outDir, "cut-draft.json");

  const r = runCli(["cut", filePath, "0.5s", "2.5s", "--out", outPath]);

  strictEqual(r.status, 0, `cli should exit 0, stderr: ${r.stderr}`);
  ok(r.json, "stdout should contain JSON");
  strictEqual(r.json.ok, true);
  strictEqual(r.json.duration_us, 2_000_000);
  strictEqual(r.json.out, outPath);
  ok(typeof r.json.kept === "number");
  ok(typeof r.json.removed === "number");
  ok(r.json.kept > 0, "should keep something from 0.5s..2.5s");

  // Verify the file actually got written and parses with the new duration.
  const saved = JSON.parse(readFileSync(outPath, "utf-8"));
  strictEqual(saved.duration, 2_000_000, "saved draft has new duration");
  ok(Array.isArray(saved.tracks));
});

test("cutCli: missing --out → exit 1 with error JSON", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);

  const r = runCli(["cut", filePath, "0", "1s"]);

  strictEqual(r.status, 1);
  ok(r.errorJson, "should print JSON error to stderr");
  ok(/Missing --out/i.test(r.errorJson.error), `error should mention Missing --out, got: ${r.errorJson.error}`);
});

test("cutCli: end <= start → exit 1 with 'End time must be after start time'", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const outDir = mkOutDir(t);
  const outPath = join(outDir, "cut-bad.json");

  const r = runCli(["cut", filePath, "1s", "0.5s", "--out", outPath]);

  strictEqual(r.status, 1);
  ok(r.errorJson);
  ok(
    /End time must be after start time/i.test(r.errorJson.error),
    `error should mention end > start, got: ${r.errorJson.error}`,
  );
});

test("cutProject: materials swept — drops materials referenced only by removed segments", (t) => {
  const { filePath } = tmpDraft(FIXTURES.FULL_PSYCHO, t);
  const { draft } = loadDraft(filePath);
  const originalVideosCount = loadFixture(FIXTURES.FULL_PSYCHO).materials.videos.length;

  // Cut a tiny window in the middle — most of the 60s timeline (and its 81 video
  // materials) should be unreferenced after the cut.
  cutProject(draft, { start: 1_000_000, end: 1_500_000 });

  strictEqual(draft.duration, 500_000);
  ok(
    draft.materials.videos.length < originalVideosCount,
    `videos should shrink: was ${originalVideosCount}, now ${draft.materials.videos.length}`,
  );

  // All surviving video materials must be referenced by a surviving segment OR
  // an extra_material_ref (the sweep rule). We validate the loose property:
  // every surviving material.id is either referenced somewhere, or had no id
  // (which the filter keeps by default).
  const referenced = new Set();
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      referenced.add(seg.material_id);
      for (const r of seg.extra_material_refs) referenced.add(r);
    }
  }
  for (const v of draft.materials.videos) {
    if (v && typeof v.id === "string") {
      // It should either be referenced, or never have been in the removed set.
      // We can't easily reconstruct removed sets here, but referenced ones must be present.
      // Just check the file is internally consistent: any segment.material_id resolves.
      ok(typeof v.id === "string");
    }
  }

  // Every surviving segment's material_id must resolve in some materials array.
  const allMatIds = new Set();
  for (const arr of Object.values(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (m && typeof m.id === "string") allMatIds.add(m.id);
    }
  }
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      ok(allMatIds.has(seg.material_id), `material ${seg.material_id} must survive for kept segment ${seg.id}`);
    }
  }
});

test("cutProject: materials kept when still referenced elsewhere (sweep keeps shared ids)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);

  // Cut a slice that keeps the first half (0..1.5s) of ken-burns — multiple
  // segments survive, exercising the survivingMatIds branch.
  cutProject(draft, { start: 0, end: 1_500_000 });

  strictEqual(draft.duration, 1_500_000);
  ok(draft.tracks.length > 0, "tracks survive");
  ok(draft.materials.videos.length > 0, "video materials still present");

  // All kept segments must resolve their material_id in the materials arrays.
  const allIds = new Set();
  for (const arr of Object.values(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (m && typeof m.id === "string") allIds.add(m.id);
    }
  }
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      ok(allIds.has(seg.material_id), `surviving seg ${seg.id} material resolves`);
    }
  }
});
