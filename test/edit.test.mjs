// Coverage for src/commands/edit.ts (compiled to dist/commands/edit.js).
// Strategy:
//   - Happy paths invoke the exported cmdXxx functions directly against a
//     freshly-copied tmp fixture, assert in-memory mutation, then re-load via
//     loadDraft to confirm saveDraft persisted to disk.
//   - Error paths spawn the built binary via runCli() and assert exit code 1
//     plus the JSON error message on stderr.

import { test } from "node:test";
import { strictEqual, ok, match, notStrictEqual } from "node:assert";
import { statSync } from "node:fs";

import {
  cmdSetText,
  cmdShift,
  cmdShiftAll,
  cmdSpeed,
  cmdVolume,
  cmdOpacity,
  cmdTrim,
} from "../dist/commands/edit.js";
import { loadDraft, extractText } from "../dist/draft.js";

import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const flagsQuiet = { human: false, quiet: true };

function firstSegmentOfType(draft, type) {
  const track = draft.tracks.find((t) => t.type === type && t.segments.length > 0);
  if (!track) throw new Error(`No track of type ${type} with segments in fixture`);
  return { track, segment: track.segments[0] };
}

// ---------------------------------------------------------------------------
// set-text
// ---------------------------------------------------------------------------

test("cmdSetText: happy path mutates material content and persists to disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "text");

  cmdSetText(draft, filePath, seg.id, "Lorem replaced", flagsQuiet);

  // In-memory: material content now reflects the new text.
  const mat = draft.materials.texts.find((m) => m.id === seg.material_id);
  ok(mat, "material lookup");
  strictEqual(extractText(mat.content), "Lorem replaced");

  // On disk: re-load and verify persistence.
  const { draft: after } = loadDraft(filePath);
  const matAfter = after.materials.texts.find((m) => m.id === seg.material_id);
  strictEqual(extractText(matAfter.content), "Lorem replaced");
});

test("cmdSetText: save=false does not write to disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const mtimeBefore = statSync(filePath).mtimeMs;
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "text");

  cmdSetText(draft, filePath, seg.id, "Not saved", flagsQuiet, false);

  const { draft: afterReload } = loadDraft(filePath);
  const matAfter = afterReload.materials.texts.find((m) => m.id === seg.material_id);
  notStrictEqual(extractText(matAfter.content), "Not saved");
  const mtimeAfter = statSync(filePath).mtimeMs;
  strictEqual(mtimeAfter, mtimeBefore);
});

test("set-text: missing segment id exits 1 with 'Segment not found'", () => {
  const r = runCli(["set-text", fixturePath(FIXTURES.SUBTITLES), "nonexistent-id-xxx", "x"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Segment not found/);
});

test("set-text: non-text segment id exits 1 with 'Text material not found'", () => {
  // Pick a video segment id from KEN_BURNS, then run set-text against it.
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: videoSeg } = firstSegmentOfType(draft, "video");
  const r = runCli(["set-text", fixturePath(FIXTURES.KEN_BURNS), videoSeg.id, "noop"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Text material not found/);
});

// ---------------------------------------------------------------------------
// shift
// ---------------------------------------------------------------------------

test("cmdShift: +500ms advances target_timerange.start and persists", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const oldStart = seg.target_timerange.start;

  cmdShift(draft, filePath, seg.id, "+500ms", flagsQuiet);

  strictEqual(seg.target_timerange.start, oldStart + 500_000);

  const { draft: after } = loadDraft(filePath);
  const segAfter = after.tracks
    .flatMap((tr) => tr.segments)
    .find((s) => s.id === seg.id);
  strictEqual(segAfter.target_timerange.start, oldStart + 500_000);
});

test("cmdShift: negative offset clamps to 0 (Math.max guard)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "video");

  cmdShift(draft, filePath, seg.id, "-10s", flagsQuiet);

  strictEqual(seg.target_timerange.start, 0);
});

test("shift: missing segment exits 1 with 'Segment not found'", () => {
  const r = runCli(["shift", fixturePath(FIXTURES.KEN_BURNS), "nonexistent", "+1s"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Segment not found/);
});

// ---------------------------------------------------------------------------
// shift-all
// ---------------------------------------------------------------------------

test("cmdShiftAll: track-filtered shifts only that track type", (t) => {
  const { filePath } = tmpDraft(FIXTURES.FULL_PSYCHO, t);
  const { draft } = loadDraft(filePath);

  // Snapshot starts by track type.
  const snapshot = new Map();
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      snapshot.set(seg.id, { type: track.type, start: seg.target_timerange.start });
    }
  }

  cmdShiftAll(draft, filePath, "+1s", { ...flagsQuiet, track: "video" }, true);

  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      const prev = snapshot.get(seg.id);
      if (prev.type === "video") {
        strictEqual(
          seg.target_timerange.start,
          Math.max(0, prev.start + 1_000_000),
          `video seg ${seg.id} should shift +1s`,
        );
      } else {
        strictEqual(
          seg.target_timerange.start,
          prev.start,
          `non-video seg ${seg.id} (${prev.type}) should be unchanged`,
        );
      }
    }
  }

  // Verify on-disk persistence for video segments.
  const { draft: after } = loadDraft(filePath);
  for (const track of after.tracks.filter((tr) => tr.type === "video")) {
    for (const seg of track.segments) {
      const prev = snapshot.get(seg.id);
      strictEqual(seg.target_timerange.start, Math.max(0, prev.start + 1_000_000));
    }
  }
});

test("cmdShiftAll: without flags.track shifts every segment", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);

  const snapshot = new Map();
  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      snapshot.set(seg.id, seg.target_timerange.start);
    }
  }

  cmdShiftAll(draft, filePath, "+250ms", flagsQuiet, true);

  for (const track of draft.tracks) {
    for (const seg of track.segments) {
      strictEqual(seg.target_timerange.start, Math.max(0, snapshot.get(seg.id) + 250_000));
    }
  }
});

test("shift-all: invalid time format exits 1 with 'Invalid time'", () => {
  const r = runCli(["shift-all", fixturePath(FIXTURES.KEN_BURNS), "garbage-time"]);
  strictEqual(r.status, 1);
  ok(r.stderr.includes("Invalid time"), `stderr was: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// speed
// ---------------------------------------------------------------------------

test("cmdSpeed: 2.0 sets seg.speed and recomputes source_timerange.duration", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const targetDur = seg.target_timerange.duration;

  cmdSpeed(draft, filePath, seg.id, "2.0", flagsQuiet);

  strictEqual(seg.speed, 2);
  strictEqual(seg.source_timerange.duration, Math.round(targetDur * 2));

  // Persistence check.
  const { draft: after } = loadDraft(filePath);
  const segAfter = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === seg.id);
  strictEqual(segAfter.speed, 2);
  strictEqual(segAfter.source_timerange.duration, Math.round(targetDur * 2));
});

test("cmdSpeed: also updates a referenced speeds material when present", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);

  // Find any segment whose extra_material_refs points at a speeds material.
  let target = null;
  outer: for (const track of draft.tracks) {
    for (const seg of track.segments) {
      for (const refId of seg.extra_material_refs ?? []) {
        if (draft.materials.speeds.some((s) => s.id === refId)) {
          target = { seg, refId };
          break outer;
        }
      }
    }
  }

  if (!target) {
    // Fixture has no speed material ref; synthesize one to exercise the branch.
    const { segment: anySeg } = firstSegmentOfType(draft, "video");
    const fakeId = "test-speed-material-id";
    draft.materials.speeds.push({ id: fakeId, speed: 1.0, type: "speed" });
    anySeg.extra_material_refs = [...(anySeg.extra_material_refs ?? []), fakeId];
    target = { seg: anySeg, refId: fakeId };
  }

  cmdSpeed(draft, filePath, target.seg.id, "3.0", flagsQuiet);

  const speedMat = draft.materials.speeds.find((s) => s.id === target.refId);
  ok(speedMat, "speed material exists");
  strictEqual(speedMat.speed, 3);
});

test("speed: non-numeric multiplier exits 1 with 'Speed must be a positive number'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const r = runCli(["speed", fixturePath(FIXTURES.KEN_BURNS), seg.id, "abc"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Speed must be a positive number/);
});

test("speed: negative multiplier exits 1 with 'Speed must be a positive number'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const r = runCli(["speed", fixturePath(FIXTURES.KEN_BURNS), seg.id, "-1"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Speed must be a positive number/);
});

// ---------------------------------------------------------------------------
// volume
// ---------------------------------------------------------------------------

test("cmdVolume: 0.5 updates audio segment volume and persists", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "audio");

  cmdVolume(draft, filePath, seg.id, "0.5", flagsQuiet);

  strictEqual(seg.volume, 0.5);

  const { draft: after } = loadDraft(filePath);
  const segAfter = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === seg.id);
  strictEqual(segAfter.volume, 0.5);
});

test("volume: negative value exits 1 with 'Volume must be >= 0'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "audio");
  const r = runCli(["volume", fixturePath(FIXTURES.KEN_BURNS), seg.id, "-0.1"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Volume must be >= 0/);
});

test("volume: non-numeric value exits 1 with 'Volume must be >= 0'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "audio");
  const r = runCli(["volume", fixturePath(FIXTURES.KEN_BURNS), seg.id, "abc"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Volume must be >= 0/);
});

// ---------------------------------------------------------------------------
// opacity
// ---------------------------------------------------------------------------

test("cmdOpacity: 0.5 mutates clip.alpha and persists", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "video");
  ok(seg.clip, "video segment must have a clip block in fixture");

  cmdOpacity(draft, filePath, seg.id, "0.5", flagsQuiet);

  strictEqual(seg.clip.alpha, 0.5);

  const { draft: after } = loadDraft(filePath);
  const segAfter = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === seg.id);
  strictEqual(segAfter.clip.alpha, 0.5);
});

test("opacity: out-of-range value exits 1 with 'Opacity must be 0.0-1.0'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const r = runCli(["opacity", fixturePath(FIXTURES.KEN_BURNS), seg.id, "1.5"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /Opacity must be 0\.0-1\.0/);
});

test("opacity: audio segment (no clip) exits 1 with 'no clip'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: audioSeg } = firstSegmentOfType(draft, "audio");
  const r = runCli(["opacity", fixturePath(FIXTURES.KEN_BURNS), audioSeg.id, "0.5"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `errorJson missing; stderr=${r.stderr}`);
  match(r.errorJson.error, /no clip/);
});

// ---------------------------------------------------------------------------
// trim
// ---------------------------------------------------------------------------

test("cmdTrim: sets source_timerange and recomputes target_timerange.duration by speed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const speed = seg.speed;

  cmdTrim(draft, filePath, seg.id, "0", "1s", flagsQuiet);

  strictEqual(seg.source_timerange.start, 0);
  strictEqual(seg.source_timerange.duration, 1_000_000);
  strictEqual(seg.target_timerange.duration, Math.round(1_000_000 / speed));

  const { draft: after } = loadDraft(filePath);
  const segAfter = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === seg.id);
  strictEqual(segAfter.source_timerange.start, 0);
  strictEqual(segAfter.source_timerange.duration, 1_000_000);
  strictEqual(segAfter.target_timerange.duration, Math.round(1_000_000 / speed));
});

test("trim: invalid time format exits 1 with 'Invalid time'", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  const { segment: seg } = firstSegmentOfType(draft, "video");
  const r = runCli(["trim", fixturePath(FIXTURES.KEN_BURNS), seg.id, "garbage", "1s"]);
  strictEqual(r.status, 1);
  ok(r.stderr.includes("Invalid time"), `stderr was: ${r.stderr}`);
});
