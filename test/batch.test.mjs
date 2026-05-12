// Tests for src/commands/batch.ts (cmdBatch).
//
// cmdBatch reads JSONL from fd 0 (stdin) and dispatches each op to the
// underlying edit commands. Direct in-process testing would require faking
// stdin; instead we drive the built CLI via runCli with `input` (stdin).
//
// Per-op execution failures (bad cmd, missing fields, malformed JSON, op-level
// die()) are counted in `failed` and reported to stderr — the outer command
// still exits 0. Only the empty-stdin guard exits non-zero.

import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, match } from "node:assert";
import { readFileSync } from "node:fs";

import { runCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { loadFixture, FIXTURES } from "./helpers/load-fixture.mjs";
import { extractText } from "../dist/draft.js";

// --- helpers ---------------------------------------------------------------

function reloadDraft(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function firstTextSeg(fixtureKey) {
  const fx = loadFixture(fixtureKey);
  const track = fx.tracks.find((t) => t.type === "text");
  return { fx, seg: track.segments[0] };
}

function firstSegOfType(fx, type) {
  const track = fx.tracks.find((t) => t.type === type);
  return track ? track.segments[0] : null;
}

// --- Test 1: single set-text op (happy path) -------------------------------

test("batch: single set-text op succeeds and mutates on disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { seg } = firstTextSeg(FIXTURES.SUBTITLES);

  const jsonl = `${JSON.stringify({ cmd: "set-text", id: seg.id, text: "Patched" })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 0 });

  const after = reloadDraft(filePath);
  const mat = after.materials.texts.find((m) => m.id === seg.material_id);
  ok(mat, "text material should still exist");
  strictEqual(extractText(mat.content), "Patched");
});

// --- Test 2: multi-op JSONL (speed + volume + opacity) ---------------------

test("batch: multi-op JSONL mixes speed/volume/opacity, all succeed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const fx = loadFixture(FIXTURES.KEN_BURNS);

  const videoSeg = firstSegOfType(fx, "video");
  const audioSeg = firstSegOfType(fx, "audio");
  ok(videoSeg && audioSeg, "ken-burns fixture must have video+audio segments");

  const ops = [
    { cmd: "speed", id: videoSeg.id, speed: 2 },
    { cmd: "volume", id: audioSeg.id, volume: 0.25 },
    { cmd: "opacity", id: videoSeg.id, opacity: 0.5 },
  ];
  const jsonl = ops.map((o) => JSON.stringify(o)).join("\n") + "\n";

  const r = runCli(["batch", filePath], { input: jsonl });
  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 3, failed: 0 });

  const after = reloadDraft(filePath);
  const vAfter = after.tracks
    .find((t) => t.type === "video")
    .segments.find((s) => s.id === videoSeg.id);
  const aAfter = after.tracks
    .find((t) => t.type === "audio")
    .segments.find((s) => s.id === audioSeg.id);

  strictEqual(vAfter.speed, 2, "video segment speed should be 2");
  strictEqual(vAfter.clip.alpha, 0.5, "video segment opacity should be 0.5");
  strictEqual(aAfter.volume, 0.25, "audio segment volume should be 0.25");
});

// --- Test 3: shift-all with track filter -----------------------------------

test("batch: shift-all with track=video advances only video segments", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const before = reloadDraft(filePath);

  const videoStartsBefore = before.tracks
    .filter((tr) => tr.type === "video")
    .flatMap((tr) => tr.segments.map((s) => ({ id: s.id, start: s.target_timerange.start })));
  const audioStartsBefore = before.tracks
    .filter((tr) => tr.type === "audio")
    .flatMap((tr) => tr.segments.map((s) => ({ id: s.id, start: s.target_timerange.start })));

  const jsonl = `${JSON.stringify({ cmd: "shift-all", offset: "+500ms", track: "video" })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 0 });

  const after = reloadDraft(filePath);

  for (const { id, start } of videoStartsBefore) {
    const seg = after.tracks
      .find((tr) => tr.type === "video" && tr.segments.some((s) => s.id === id))
      .segments.find((s) => s.id === id);
    strictEqual(
      seg.target_timerange.start,
      Math.max(0, start + 500_000),
      `video seg ${id} should be shifted +500ms`,
    );
  }
  for (const { id, start } of audioStartsBefore) {
    const seg = after.tracks
      .find((tr) => tr.type === "audio" && tr.segments.some((s) => s.id === id))
      .segments.find((s) => s.id === id);
    strictEqual(seg.target_timerange.start, start, `audio seg ${id} should be unchanged`);
  }
});

// --- Test 4: trim op -------------------------------------------------------

test("batch: trim op sets source_timerange duration to 1s", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  const videoSeg = firstSegOfType(fx, "video");

  const jsonl = `${JSON.stringify({
    cmd: "trim",
    id: videoSeg.id,
    start: "0",
    duration: "1s",
  })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 0 });

  const after = reloadDraft(filePath);
  const vAfter = after.tracks
    .find((tr) => tr.type === "video")
    .segments.find((s) => s.id === videoSeg.id);
  strictEqual(vAfter.source_timerange.start, 0);
  strictEqual(vAfter.source_timerange.duration, 1_000_000);
});

// --- Test 5: shift op (individual segment) ---------------------------------

test("batch: shift op shifts one segment, leaves others alone", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const before = reloadDraft(filePath);
  const videoTrack = before.tracks.find((tr) => tr.type === "video");
  const target = videoTrack.segments[0];
  const others = videoTrack.segments.slice(1).map((s) => ({
    id: s.id,
    start: s.target_timerange.start,
  }));

  const jsonl = `${JSON.stringify({ cmd: "shift", id: target.id, offset: "+250ms" })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 0 });

  const after = reloadDraft(filePath);
  const afterVideo = after.tracks.find((tr) => tr.type === "video");
  const movedAfter = afterVideo.segments.find((s) => s.id === target.id);
  strictEqual(
    movedAfter.target_timerange.start,
    Math.max(0, target.target_timerange.start + 250_000),
    "target segment should be shifted",
  );
  for (const { id, start } of others) {
    const s = afterVideo.segments.find((x) => x.id === id);
    strictEqual(s.target_timerange.start, start, `untargeted seg ${id} should be unchanged`);
  }
});

// --- Test 6: empty + whitespace lines are skipped --------------------------

test("batch: whitespace and empty lines are skipped, only valid op counted", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { seg } = firstTextSeg(FIXTURES.SUBTITLES);

  const jsonl =
    "\n   \n" +
    `${JSON.stringify({ cmd: "set-text", id: seg.id, text: "SkippedBlanks" })}\n` +
    "\n\n";

  const r = runCli(["batch", filePath], { input: jsonl });
  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 0 });

  const after = reloadDraft(filePath);
  const mat = after.materials.texts.find((m) => m.id === seg.material_id);
  strictEqual(extractText(mat.content), "SkippedBlanks");
});

// --- Test 7: unknown cmd → failed=1, op error in stderr --------------------

test("batch: unknown op cmd is counted as failed (status=0, stderr error)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);

  const jsonl = `${JSON.stringify({ cmd: "nonexistent", id: "x" })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 0, failed: 1 });
  ok(
    r.stderr.includes("Unknown batch command: nonexistent"),
    `stderr should mention unknown cmd, got: ${r.stderr}`,
  );
});

// --- Test 8: missing required field per op ---------------------------------

test("batch: set-text without text is failed with descriptive error", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { seg } = firstTextSeg(FIXTURES.SUBTITLES);

  const jsonl = `${JSON.stringify({ cmd: "set-text", id: seg.id })}\n`;
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 0, failed: 1 });
  ok(
    r.stderr.includes("batch set-text requires id and text"),
    `stderr should mention missing text, got: ${r.stderr}`,
  );
});

// --- Test 9: empty stdin → die() exits 1 ----------------------------------

test("batch: empty stdin triggers die() with non-zero exit", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);

  const r = runCli(["batch", filePath], { input: "" });

  strictEqual(r.status, 1, `expected exit 1, stderr: ${r.stderr}`);
  ok(r.errorJson, "should emit error JSON on stderr");
  match(r.errorJson.error, /No input on stdin/);
});

// --- Test 10: malformed JSON line counted as failed -----------------------

test("batch: malformed JSON line is counted as failed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);

  const jsonl = "not json\n";
  const r = runCli(["batch", filePath], { input: jsonl });

  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 0, failed: 1 });
  // stderr line is `{"error":"<JSON parse msg>","line":"not json"}`
  ok(
    r.stderr.includes(`"line":"not json"`),
    `stderr should include malformed line, got: ${r.stderr}`,
  );
});

// --- Test 11: mixed success + failure in same batch -----------------------

test("batch: mixed valid + invalid ops yields succeeded=1, failed=1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { seg } = firstTextSeg(FIXTURES.SUBTITLES);

  const jsonl =
    `${JSON.stringify({ cmd: "set-text", id: seg.id, text: "Half" })}\n` +
    `${JSON.stringify({ cmd: "shift-all" })}\n`; // missing offset → die() in op

  const r = runCli(["batch", filePath], { input: jsonl });
  strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  deepStrictEqual(r.json, { ok: true, succeeded: 1, failed: 1 });

  // Valid op still applied.
  const after = reloadDraft(filePath);
  const mat = after.materials.texts.find((m) => m.id === seg.material_id);
  strictEqual(extractText(mat.content), "Half");

  ok(
    r.stderr.includes("batch shift-all requires offset"),
    `stderr should mention missing offset, got: ${r.stderr}`,
  );
});
