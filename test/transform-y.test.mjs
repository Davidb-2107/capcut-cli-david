// Tests for import-captions --transform-y (v1.16.0): pose clip.transform.y on every
// rebuilt caption segment. Global flag only (no per-card field), finite number,
// NEGATIVES (and zero) allowed — unlike parseSizeFlag. Absent flag = byte-identical
// segments (frozen v1.15.0 oracle below).
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, match } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { importCaptions } from "../dist/commands/create.js";
import { loadDraft } from "../dist/draft.js";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const CARDS = [
  { text: "le PC", start: 0, end: 500000, hl: [3, 5] },
  { text: "est mort", start: 500000, end: 1200000 },
];

function segmentsOf(draftJson, trackId) {
  return draftJson.tracks.find((tr) => tr.id === trackId).segments;
}

// =============================================================
// Byte-identity oracle — exact segment emitted by the v1.15.0 dist for a card,
// ids normalized (random uuids → placeholders). Frozen: must never change when
// --transform-y is ABSENT.
// =============================================================

const ORACLE_SEGMENT_V1_15_0 =
  '{"id":"SEG","material_id":"MAT","raw_segment_id":"TRACK","target_timerange":{"start":0,"duration":500000},"source_timerange":{"start":0,"duration":500000},"speed":1,"volume":1,"visible":true,"reverse":false,"clip":{"alpha":1,"rotation":0,"scale":{"x":1,"y":1},"transform":{"x":0,"y":0},"flip":{"horizontal":false,"vertical":false}},"render_index":15000,"track_render_index":0,"track_attribute":0,"extra_material_refs":["C0","C1","C2","C3"],"common_keyframes":[],"keyframe_refs":[]}';

function normalizedSegment(seg) {
  const s = JSON.parse(JSON.stringify(seg));
  s.id = "SEG";
  s.material_id = "MAT";
  s.raw_segment_id = "TRACK";
  s.extra_material_refs = s.extra_material_refs.map((_, i) => `C${i}`);
  return JSON.stringify(s);
}

test("byte-identity: importCaptions WITHOUT transformY → segment byte-identical to v1.15.0", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "le PC", start: 0, end: 500000, hl: [3, 5] }],
    trackName: "subtitle",
  });
  const seg = segmentsOf(draft, res.trackId)[0];
  strictEqual(normalizedSegment(seg), ORACLE_SEGMENT_V1_15_0);
});

// =============================================================
// importCaptions — transformY option (lean + clone paths)
// =============================================================

test("importCaptions: transformY sets clip.transform.y on EVERY rebuilt segment (lean)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle", transformY: -0.4 });
  const segs = segmentsOf(draft, res.trackId);
  strictEqual(segs.length, 2);
  for (const seg of segs) {
    strictEqual(seg.clip.transform.y, -0.4, "transform.y must carry the flag value");
    strictEqual(seg.clip.transform.x, 0, "transform.x must stay untouched");
  }
});

test("importCaptions: transformY rides the --clone-style path too", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: CARDS,
    trackName: "subtitle",
    cloneStyle: true,
    transformY: -0.6,
  });
  for (const seg of segmentsOf(draft, res.trackId)) {
    strictEqual(seg.clip.transform.y, -0.6);
  }
});

test("importCaptions: segment lands on the target track (raw_segment_id) before id normalization", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "le PC", start: 0, end: 500000, hl: [3, 5] }],
    trackName: "subtitle",
  });
  const seg = segmentsOf(draft, res.trackId)[0];
  strictEqual(seg.raw_segment_id, res.trackId, "raw_segment_id must be the track id (oracle normalizes it)");
});

// =============================================================
// CLI — --transform-y flag (negative / positive / invalid / empty / help marker)
// =============================================================

function writeCards(filePath, cards = CARDS) {
  const jsonPath = join(dirname(filePath), "captions.json");
  writeFileSync(jsonPath, JSON.stringify(cards), "utf-8");
  return jsonPath;
}

test("import-captions --transform-y (CLI): negative value lands on every caption segment", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "-0.4", "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const segs = segmentsOf(after, r.json.track_id);
  strictEqual(segs.length, 2);
  for (const seg of segs) strictEqual(seg.clip.transform.y, -0.4);
});

test("import-captions --transform-y (CLI): zero accepted (centre — parser must NOT require > 0)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "0", "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  for (const seg of segmentsOf(after, r.json.track_id)) strictEqual(seg.clip.transform.y, 0);
});

test("import-captions --transform-y=<n> (CLI): equals syntax is REFUSED, not silently ignored", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y=-0.4", "--track-name", "subtitle"]);
  strictEqual(r.status, 1, "equals form must die, not import recentered captions with rc 0");
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("import-captions --transform-y as LAST arg (CLI): missing value is REFUSED, not silently dropped", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle", "--transform-y"]);
  strictEqual(r.status, 1, "value-less flag must die, not import recentered captions with rc 0");
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("import-captions --transform-y (CLI): whitespace-only value → CliError (Number('  ')===0 trap)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "  ", "--track-name", "subtitle"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("import-captions --transform-y (CLI): Infinity → CliError (isFinite contract, not just NaN)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "Infinity", "--track-name", "subtitle"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("add-text given --transform-y (CLI): flag is consumed and ignored — does NOT leak into the caption text", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "hello", "world", "--transform-y", "-0.4"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  strictEqual(r.json.text, "hello world", "v1.16.0 contract: flag+value no longer join into the text");
});

test("import-captions --transform-y (CLI): positive value accepted", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "0.25", "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  for (const seg of segmentsOf(after, r.json.track_id)) strictEqual(seg.clip.transform.y, 0.25);
});

test("import-captions --transform-y (CLI): non-numeric value → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "abc", "--track-name", "subtitle"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("import-captions --transform-y (CLI): empty value → CliError status 1 (Number('')===0 trap)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--transform-y", "", "--track-name", "subtitle"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--transform-y/);
});

test("import-captions WITHOUT --transform-y (CLI): transform stays {0,0} — flag-absent contract", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = writeCards(filePath);
  const r = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  for (const seg of segmentsOf(after, r.json.track_id)) {
    deepStrictEqual(seg.clip.transform, { x: 0, y: 0 });
  }
});

test("--help advertises --transform-y (preflight marker for orchestrator version gates)", () => {
  const r = runCli(["--help"]);
  strictEqual(r.status, 0);
  ok(r.stdout.includes("--transform-y"), "--help must contain the --transform-y marker");
});
