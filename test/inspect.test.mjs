// inspect.test.mjs — coverage for src/commands/inspect.ts
// info, tracks, materials, segments, texts, export-srt, segment, material
//
// Most inspect commands print JSON to stdout via the `out()` helper. We spawn
// the built binary (runCli) for clean stdout capture + status assertions,
// and cross-check the JSON against loadFixture() data for shape and counts.
//
// Read-only commands → no tmpDraft needed; we can point runCli straight at
// the fixture file on disk.

import { test } from "node:test";
import { strictEqual, ok, match, deepStrictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { FIXTURES, fixturePath, loadFixture } from "./helpers/load-fixture.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";

// ----- info -----------------------------------------------------------------

test("info: SUBTITLES JSON has expected top-level fields", () => {
  const r = runCli(["info", fixturePath(FIXTURES.SUBTITLES)]);
  strictEqual(r.status, 0);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  ok(typeof r.json.id === "string");
  ok(typeof r.json.duration_us === "number");
  ok(typeof r.json.fps === "number");
  ok(typeof r.json.width === "number");
  ok(typeof r.json.height === "number");
  ok(typeof r.json.ratio === "string");
  ok(Array.isArray(r.json.material_summary));
  const fx = loadFixture(FIXTURES.SUBTITLES);
  strictEqual(r.json.tracks, fx.tracks.length);
});

test("info: MINIMAL fixture has 0 tracks and 0 segments", () => {
  const r = runCli(["info", fixturePath(FIXTURES.MINIMAL)]);
  strictEqual(r.status, 0);
  ok(r.json);
  strictEqual(r.json.tracks, 0);
  strictEqual(r.json.segments, 0);
});

test("info: human flag prints 'Project:' header line", () => {
  const r = runCli(["info", fixturePath(FIXTURES.MINIMAL), "-H"]);
  strictEqual(r.status, 0);
  ok(r.stdout.includes("Project:"), `human output missing 'Project:' header: ${r.stdout}`);
  ok(r.stdout.includes("Duration:"));
  ok(r.stdout.includes("Resolution:"));
});

test("info: nonexistent project path fails with helpful error", () => {
  const r = runCli(["info", "/definitely/nonexistent/draft.json"]);
  strictEqual(r.status, 1);
  ok(r.stderr.length > 0);
  ok(r.stderr.includes("No draft found") || r.stderr.includes("ENOENT"), `unexpected stderr: ${r.stderr}`);
});

// ----- tracks ---------------------------------------------------------------

test("tracks: KEN_BURNS returns array with expected shape per track", () => {
  const r = runCli(["tracks", fixturePath(FIXTURES.KEN_BURNS)]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  strictEqual(r.json.length, fx.tracks.length);
  for (const t of r.json) {
    ok(typeof t.index === "number");
    ok(typeof t.id === "string");
    ok(typeof t.type === "string");
    ok(typeof t.name === "string");
    ok(typeof t.segments === "number");
    ok(typeof t.duration_us === "number");
    ok(typeof t.muted === "boolean");
    ok(typeof t.hidden === "boolean");
    ok(typeof t.locked === "boolean");
  }
});

test("tracks: track without a name field renders in -H without throwing", (t) => {
  // Regression: cutcli-created tracks omit `name` — `tracks -H` crashed with
  // "Cannot read properties of undefined (reading 'padEnd')".
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(draft.tracks.length > 0, "fixture must have at least one track");
  delete draft.tracks[0].name;
  writeFileSync(filePath, JSON.stringify(draft));

  const rH = runCli(["tracks", filePath, "-H"]);
  strictEqual(rH.status, 0, `expected exit 0, stderr: ${rH.stderr}`);
  ok(!rH.stderr.includes("padEnd"), `padEnd crash resurfaced: ${rH.stderr}`);

  const rJson = runCli(["tracks", filePath]);
  strictEqual(rJson.status, 0);
  strictEqual(rJson.json[0].name, "", "unnamed track should normalize to empty string");
});

test("tracks: MINIMAL returns empty array", () => {
  const r = runCli(["tracks", fixturePath(FIXTURES.MINIMAL)]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json, []);
});

test("tracks: missing project path produces CLI usage error", () => {
  const r = runCli(["tracks"]);
  strictEqual(r.status, 1);
  ok(r.stderr.includes("Missing project path"), `unexpected stderr: ${r.stderr}`);
});

// ----- materials ------------------------------------------------------------

test("materials: overview mode returns sorted (desc) type counts", () => {
  const r = runCli(["materials", fixturePath(FIXTURES.FULL_PSYCHO)]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  for (const m of r.json) {
    ok(typeof m.type === "string");
    ok(typeof m.count === "number");
  }
  for (let i = 1; i < r.json.length; i++) {
    ok(r.json[i - 1].count >= r.json[i].count, `not sorted desc at index ${i}`);
  }
});

test("materials --type videos: returns per-material summaries", () => {
  const r = runCli(["materials", fixturePath(FIXTURES.FULL_PSYCHO), "--type", "videos"]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  ok(r.json.length > 0);
  for (const m of r.json) {
    ok(typeof m.id === "string");
    ok(typeof m.fields === "number");
  }
  const fx = loadFixture(FIXTURES.FULL_PSYCHO);
  strictEqual(r.json.length, fx.materials.videos.length);
});

test("materials --type texts: includes name/path fields when present", () => {
  const r = runCli(["materials", fixturePath(FIXTURES.SUBTITLES), "--type", "texts"]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  ok(r.json.length > 0);
});

test("materials --type bogus: errors with 'Unknown material type'", () => {
  const r = runCli(["materials", fixturePath(FIXTURES.MINIMAL), "--type", "bogus_type_xyz"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr: ${r.stderr}`);
  match(r.errorJson.error, /Unknown material type/);
});

// ----- segments -------------------------------------------------------------

test("segments: KEN_BURNS returns flat array with expected fields", () => {
  const r = runCli(["segments", fixturePath(FIXTURES.KEN_BURNS)]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  for (const s of r.json) {
    ok(typeof s.id === "string");
    ok(typeof s.type === "string");
    ok(typeof s.start_us === "number");
    ok(typeof s.duration_us === "number");
    ok(typeof s.speed === "number");
    ok(typeof s.volume === "number");
    ok(typeof s.opacity === "number");
    ok(typeof s.label === "string");
  }
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  const expected = fx.tracks.reduce((n, t) => n + t.segments.length, 0);
  strictEqual(r.json.length, expected);
});

test("segments --track video: filters to video segments only", () => {
  const r = runCli(["segments", fixturePath(FIXTURES.KEN_BURNS), "--track", "video"]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  for (const s of r.json) strictEqual(s.type, "video");
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  const expected = fx.tracks
    .filter((t) => t.type === "video")
    .reduce((n, t) => n + t.segments.length, 0);
  strictEqual(r.json.length, expected);
});

test("segments --track sticker on MINIMAL: errors with 'No tracks of type'", () => {
  const r = runCli(["segments", fixturePath(FIXTURES.MINIMAL), "--track", "sticker"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error on stderr: ${r.stderr}`);
  match(r.errorJson.error, /No tracks of type/);
});

// ----- texts ----------------------------------------------------------------

test("texts: SUBTITLES returns 28 text entries with non-empty text", () => {
  const r = runCli(["texts", fixturePath(FIXTURES.SUBTITLES)]);
  strictEqual(r.status, 0);
  ok(Array.isArray(r.json));
  const fx = loadFixture(FIXTURES.SUBTITLES);
  const expected = fx.tracks
    .filter((t) => t.type === "text")
    .reduce((n, t) => n + t.segments.length, 0);
  strictEqual(r.json.length, expected);
  for (const s of r.json) {
    ok(typeof s.id === "string");
    ok(typeof s.start_us === "number");
    ok(typeof s.duration_us === "number");
    ok(typeof s.text === "string");
    ok(s.text.length > 0, "anonymized LOREM tokens should not be empty");
  }
});

test("texts: MINIMAL returns empty array", () => {
  const r = runCli(["texts", fixturePath(FIXTURES.MINIMAL)]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json, []);
});

test("texts: missing project path produces usage error", () => {
  const r = runCli(["texts"]);
  strictEqual(r.status, 1);
  ok(r.stderr.includes("Missing project path"));
});

// ----- export-srt -----------------------------------------------------------

test("export-srt: SUBTITLES produces well-formed SRT", () => {
  const r = runCli(["export-srt", fixturePath(FIXTURES.SUBTITLES)]);
  strictEqual(r.status, 0);
  ok(r.stdout.length > 0);
  // First entry must start with "1\n"
  ok(/^1\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}\n/.test(r.stdout), `SRT shape unexpected: ${r.stdout.slice(0, 200)}`);
  // Count entries — blank line separates, last entry ends with \n then split yields a trailing empty.
  const entries = r.stdout.split(/\n\n/).filter((s) => s.trim().length > 0);
  const fx = loadFixture(FIXTURES.SUBTITLES);
  const expected = fx.tracks
    .filter((t) => t.type === "text")
    .reduce((n, t) => n + t.segments.length, 0);
  strictEqual(entries.length, expected);
});

test("export-srt: MINIMAL produces empty output", () => {
  const r = runCli(["export-srt", fixturePath(FIXTURES.MINIMAL)]);
  strictEqual(r.status, 0);
  strictEqual(r.stdout, "");
});

test("export-srt: missing project path produces usage error", () => {
  const r = runCli(["export-srt"]);
  strictEqual(r.status, 1);
  ok(r.stderr.includes("Missing project path"));
});

// ----- segment <id> ---------------------------------------------------------

test("segment <id>: KEN_BURNS first video segment resolves to full detail", () => {
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  const vidTrack = fx.tracks.find((t) => t.type === "video");
  ok(vidTrack, "KEN_BURNS missing a video track");
  const seg = vidTrack.segments[0];
  const r = runCli(["segment", fixturePath(FIXTURES.KEN_BURNS), seg.id.slice(0, 8)]);
  strictEqual(r.status, 0);
  ok(r.json);
  strictEqual(r.json.id, seg.id);
  strictEqual(r.json._track_type, "video");
  strictEqual(r.json._track_id, vidTrack.id);
  ok(r.json._material, "_material block missing");
  strictEqual(r.json._material._type, "videos");
});

test("segment <id>: nonexistent id errors with 'Segment not found'", () => {
  const r = runCli(["segment", fixturePath(FIXTURES.KEN_BURNS), "zzzzzz"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error: ${r.stderr}`);
  match(r.errorJson.error, /Segment not found/);
});

// ----- material <id> --------------------------------------------------------

test("material <id>: KEN_BURNS first video material resolves with _type=videos", () => {
  const fx = loadFixture(FIXTURES.KEN_BURNS);
  const mat = fx.materials.videos[0];
  ok(mat, "KEN_BURNS missing materials.videos[0]");
  const r = runCli(["material", fixturePath(FIXTURES.KEN_BURNS), mat.id.slice(0, 8)]);
  strictEqual(r.status, 0);
  ok(r.json);
  strictEqual(r.json._type, "videos");
  strictEqual(r.json.id, mat.id);
});

test("material <id>: nonexistent id errors with 'Material not found'", () => {
  const r = runCli(["material", fixturePath(FIXTURES.KEN_BURNS), "zzzzzz"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON error: ${r.stderr}`);
  match(r.errorJson.error, /Material not found/);
});
