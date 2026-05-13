// Tests for src/commands/pipeline.ts (compiled to dist/commands/pipeline.js).
// Covers: YAML parser, SRT parser, manifest validator, duration parser,
// seeded UUID determinism, E2E psycho-build run, CLI wiring.
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual, throws, match } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  makeSeededUuid,
  parseDurationToUs,
  parseSrt,
  parseYaml,
  psychoBuild,
  validateManifest,
  YamlError,
} from "../dist/commands/pipeline.js";

import { runCli } from "./helpers/spawn-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const EXAMPLE_MANIFEST = resolve(REPO_ROOT, "examples", "psycho", "manifest.example.yaml");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scratchDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cli-david-pipeline-"));
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// =============================================================
// YAML parser
// =============================================================

test("yaml: parses scalars (string/number/bool/null)", () => {
  const r = parseYaml(`a: hello\nb: 3.14\nc: true\nd: false\ne: null\nf: ~\ng: 42`);
  deepStrictEqual(r, { a: "hello", b: 3.14, c: true, d: false, e: null, f: null, g: 42 });
});

test("yaml: quoted strings preserve special chars and trim quotes", () => {
  const r = parseYaml(`a: "hello world"\nb: 'with: colon'\nc: "tab\\there"`);
  deepStrictEqual(r, { a: "hello world", b: "with: colon", c: "tab\there" });
});

test("yaml: nested block mappings", () => {
  const r = parseYaml(`outer:\n  inner:\n    leaf: 7`);
  deepStrictEqual(r, { outer: { inner: { leaf: 7 } } });
});

test("yaml: block sequence of mappings", () => {
  const r = parseYaml(`items:\n  - name: a\n    n: 1\n  - name: b\n    n: 2`);
  deepStrictEqual(r, { items: [{ name: "a", n: 1 }, { name: "b", n: 2 }] });
});

test("yaml: flow mapping `{k: v, k: v}`", () => {
  const r = parseYaml(`res: { width: 1080, height: 1920 }`);
  deepStrictEqual(r, { res: { width: 1080, height: 1920 } });
});

test("yaml: flow sequence `[a, b, c]`", () => {
  const r = parseYaml(`arr: [1, 2, 3]`);
  deepStrictEqual(r, { arr: [1, 2, 3] });
});

test("yaml: strips line comments outside quoted strings", () => {
  const r = parseYaml(`# top\na: 1 # trailing\nb: "with # hash"`);
  deepStrictEqual(r, { a: 1, b: "with # hash" });
});

test("yaml: blank lines and trailing whitespace tolerated", () => {
  const r = parseYaml(`\n\na: 1\n\nb: 2\n\n`);
  deepStrictEqual(r, { a: 1, b: 2 });
});

test("yaml: ken_burns inline flow under image entry round-trips", () => {
  const r = parseYaml(`images:\n  - path: ./a.jpg\n    ken_burns: { from: 1.0, to: 1.3, curve: ease-out }`);
  deepStrictEqual(r, { images: [{ path: "./a.jpg", ken_burns: { from: 1.0, to: 1.3, curve: "ease-out" } }] });
});

test("yaml: error includes line number for malformed mapping", () => {
  let caught;
  try { parseYaml(`a: 1\nbogus line without colon\n`); } catch (e) { caught = e; }
  ok(caught instanceof YamlError, "should throw YamlError");
  strictEqual(caught.line, 2);
});

test("yaml: unterminated flow mapping errors", () => {
  throws(() => parseYaml(`a: { x: 1`), YamlError);
});

test("yaml: parses example manifest end-to-end", () => {
  const raw = readFileSync(EXAMPLE_MANIFEST, "utf-8");
  const parsed = parseYaml(raw);
  ok(parsed && typeof parsed === "object");
  strictEqual(parsed.title, "Paranoia Spiral");
  strictEqual(parsed.resolution.width, 1080);
  strictEqual(parsed.resolution.height, 1920);
  strictEqual(parsed.fps, 30);
  strictEqual(parsed.seed, 42);
  strictEqual(parsed.images.length, 3);
  strictEqual(parsed.images[0].ken_burns.curve, "ease-out");
  strictEqual(parsed.captions.style.color, "#FFD700");
});

// =============================================================
// SRT parser
// =============================================================

test("srt: parses 3-entry block", () => {
  const src = "1\n00:00:00,000 --> 00:00:03,000\nHello world\n\n2\n00:00:03,000 --> 00:00:06,000\nLine two";
  const entries = parseSrt(src);
  strictEqual(entries.length, 2);
  strictEqual(entries[0].text, "Hello world");
  strictEqual(entries[0].start_us, 0);
  strictEqual(entries[0].end_us, 3_000_000);
  strictEqual(entries[1].start_us, 3_000_000);
  strictEqual(entries[1].end_us, 6_000_000);
});

test("srt: handles multi-line caption text", () => {
  const src = "1\n00:00:00,000 --> 00:00:02,000\nLine one\nLine two";
  const entries = parseSrt(src);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].text, "Line one\nLine two");
});

test("srt: handles CRLF line endings", () => {
  const src = "1\r\n00:00:01,500 --> 00:00:02,500\r\nHello\r\n";
  const entries = parseSrt(src);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].start_us, 1_500_000);
});

test("srt: handles missing index line (timing first)", () => {
  const src = "00:00:00,000 --> 00:00:01,000\nNoIndex";
  const entries = parseSrt(src);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].text, "NoIndex");
});

test("srt: empty input returns empty array", () => {
  strictEqual(parseSrt("").length, 0);
  strictEqual(parseSrt("\n\n  \n").length, 0);
});

test("srt: invalid timestamp format throws with line number", () => {
  throws(() => parseSrt("1\n00:00:XX,000 --> 00:00:01,000\nbad"), /SRT line/);
});

// =============================================================
// Manifest validator
// =============================================================

function minimalManifest() {
  return {
    title: "T",
    resolution: { width: 1080, height: 1920 },
    fps: 30,
    images: [{ path: "./a.jpg", duration: "1s" }],
  };
}

test("validator: accepts minimal valid manifest", () => {
  const m = validateManifest(minimalManifest());
  strictEqual(m.title, "T");
  strictEqual(m.images.length, 1);
});

test("validator: missing title errors with explanatory message", () => {
  const m = minimalManifest(); delete m.title;
  throws(() => validateManifest(m), /title/);
});

test("validator: missing resolution.width errors", () => {
  const m = minimalManifest(); m.resolution = { height: 1920 };
  throws(() => validateManifest(m), /resolution/);
});

test("validator: empty images array rejected", () => {
  const m = minimalManifest(); m.images = [];
  throws(() => validateManifest(m), /non-empty/);
});

test("validator: image missing path rejected", () => {
  const m = minimalManifest(); m.images = [{ duration: "1s" }];
  throws(() => validateManifest(m), /path/);
});

test("validator: image missing duration rejected", () => {
  const m = minimalManifest(); m.images = [{ path: "./a.jpg" }];
  throws(() => validateManifest(m), /duration/);
});

test("validator: ken_burns missing 'to' rejected", () => {
  const m = minimalManifest(); m.images = [{ path: "./a.jpg", duration: "1s", ken_burns: { from: 1.0 } }];
  throws(() => validateManifest(m), /to/);
});

test("validator: voice without path rejected", () => {
  const m = minimalManifest(); m.voice = { volume: 1 };
  throws(() => validateManifest(m), /voice/);
});

test("validator: captions without srt path rejected", () => {
  const m = minimalManifest(); m.captions = { style: {} };
  throws(() => validateManifest(m), /srt/);
});

test("validator: default fps=30 when omitted", () => {
  const m = minimalManifest(); delete m.fps;
  strictEqual(validateManifest(m).fps, 30);
});

// =============================================================
// Duration parser
// =============================================================

test("duration: parses 's', 'ms', 'm', bare seconds", () => {
  strictEqual(parseDurationToUs("3s"), 3_000_000);
  strictEqual(parseDurationToUs("500ms"), 500_000);
  strictEqual(parseDurationToUs("1.5"), 1_500_000);
  strictEqual(parseDurationToUs("2m"), 120_000_000);
});

test("duration: rejects garbage", () => {
  throws(() => parseDurationToUs("abc"));
  throws(() => parseDurationToUs("3 hours"));
});

// =============================================================
// Seeded UUID determinism
// =============================================================

test("seeded uuid: same seed → same sequence; different seed → different", () => {
  const a = makeSeededUuid("foo");
  const b = makeSeededUuid("foo");
  const c = makeSeededUuid("bar");
  for (let i = 0; i < 4; i++) {
    const ai = a(), bi = b();
    strictEqual(ai, bi, `seq[${i}] should match`);
    match(ai, UUID_RE);
  }
  const a0 = makeSeededUuid("foo")();
  const c0 = c();
  ok(a0 !== c0, "different seed should give different uuid");
});

test("seeded uuid: numeric seed also stable", () => {
  const a = makeSeededUuid(42);
  const b = makeSeededUuid(42);
  strictEqual(a(), b());
});

// =============================================================
// E2E: psychoBuild against example manifest
// =============================================================

function copyExampleTo(dir) {
  const srcDir = resolve(REPO_ROOT, "examples", "psycho");
  const destAssets = resolve(dir, "assets");
  mkdirSync(destAssets, { recursive: true });
  for (const f of ["img1.jpg", "img2.jpg", "img3.jpg", "narration.mp3", "ambient.mp3", "captions.srt"]) {
    copyFileSync(resolve(srcDir, "assets", f), resolve(destAssets, f));
  }
  copyFileSync(EXAMPLE_MANIFEST, resolve(dir, "manifest.yaml"));
  return resolve(dir, "manifest.yaml");
}

test("e2e: psychoBuild produces a complete draft with expected counts", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "paranoia-spiral");
  const result = psychoBuild(manifest, outDir, "42");
  ok(existsSync(result.filePath), "draft_content.json should exist");
  strictEqual(result.images, 3);
  strictEqual(result.voice, true);
  strictEqual(result.music, true);
  strictEqual(result.captions, 3);
  strictEqual(result.total_duration_us, 9_000_000);

  const draft = JSON.parse(readFileSync(result.filePath, "utf-8"));
  strictEqual(draft.canvas_config.width, 1080);
  strictEqual(draft.canvas_config.height, 1920);
  strictEqual(draft.fps, 30);

  const videoTracks = draft.tracks.filter((t) => t.type === "video");
  const audioTracks = draft.tracks.filter((t) => t.type === "audio");
  const textTracks = draft.tracks.filter((t) => t.type === "text");
  strictEqual(videoTracks.length, 1, "one video track");
  strictEqual(videoTracks[0].segments.length, 3, "3 video segments");
  strictEqual(audioTracks.length, 2, "voice + music = two audio tracks");
  ok(audioTracks.some((tr) => tr.name === "voice"));
  ok(audioTracks.some((tr) => tr.name === "music"));
  strictEqual(textTracks.length, 1);
  strictEqual(textTracks[0].segments.length, 3, "3 caption segments");

  // Every video segment should carry KFTypeScaleX + KFTypeScaleY containers
  // from the ken-burns step (4 keyframes per segment).
  for (const seg of videoTracks[0].segments) {
    const sx = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
    const sy = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleY");
    ok(sx && sy, "video segment should have both scale_x/scale_y kf containers");
    strictEqual(sx.keyframe_list.length, 2);
    strictEqual(sy.keyframe_list.length, 2);
  }

  // Music track should have segment.volume = 0.25 from the manifest.
  const musicSeg = audioTracks.find((tr) => tr.name === "music").segments[0];
  strictEqual(musicSeg.volume, 0.25);
  const voiceSeg = audioTracks.find((tr) => tr.name === "voice").segments[0];
  strictEqual(voiceSeg.volume, 1.0);
});

test("e2e: same seed produces byte-identical draft on two runs", (t) => {
  const tmpA = scratchDir(t);
  const tmpB = scratchDir(t);
  const mA = copyExampleTo(tmpA);
  const mB = copyExampleTo(tmpB);
  const rA = psychoBuild(mA, resolve(tmpA, "build", "out"), "stable-seed");
  const rB = psychoBuild(mB, resolve(tmpB, "build", "out"), "stable-seed");

  const draftA = JSON.parse(readFileSync(rA.filePath, "utf-8"));
  const draftB = JSON.parse(readFileSync(rB.filePath, "utf-8"));
  // The local file paths embedded in materials.videos[*].path and
  // materials.audios[*].path differ because the two tmp dirs differ. Strip
  // volatile fields before comparing structure (IDs are seed-derived, so
  // they should match).
  //
  // material_name (video) and name (audio) also contain a path-shaped value
  // on Windows: upstream's `opts.path.split("/").pop()` doesn't split on
  // backslashes, so the whole absolute path becomes the "filename" there.
  // Normalize all four to compare the deterministic skeleton only.
  const strip = (d) => {
    for (const v of d.materials.videos) { v.path = "PATH"; v.material_name = "NAME"; }
    for (const a of d.materials.audios) { a.path = "PATH"; a.name = "NAME"; }
    return d;
  };
  deepStrictEqual(strip(draftA), strip(draftB));
});

test("e2e: different seed produces different segment IDs", (t) => {
  const tmpA = scratchDir(t);
  const tmpB = scratchDir(t);
  const mA = copyExampleTo(tmpA);
  const mB = copyExampleTo(tmpB);
  const rA = psychoBuild(mA, resolve(tmpA, "build", "out"), "seed-A");
  const rB = psychoBuild(mB, resolve(tmpB, "build", "out"), "seed-B");
  const dA = JSON.parse(readFileSync(rA.filePath, "utf-8"));
  const dB = JSON.parse(readFileSync(rB.filePath, "utf-8"));
  const segA = dA.tracks.find((t) => t.type === "video").segments[0].id;
  const segB = dB.tracks.find((t) => t.type === "video").segments[0].id;
  ok(segA !== segB, "segment ids should differ across seeds");
});

test("e2e: missing image asset produces explanatory error", (t) => {
  const tmp = scratchDir(t);
  copyExampleTo(tmp);
  // delete one asset to trigger the existence check
  rmSync(resolve(tmp, "assets", "img2.jpg"));
  let caught;
  try {
    psychoBuild(resolve(tmp, "manifest.yaml"), resolve(tmp, "build", "out"), "42");
  } catch (e) {
    caught = e;
  }
  ok(caught, "expected error when asset missing");
  match(String(caught.message), /img2\.jpg|not found/i);
});

// =============================================================
// CLI: psycho-build wiring
// =============================================================

test("cli: psycho-build with --seed runs the example and prints JSON", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "out");
  const r = runCli(["psycho-build", manifest, "--out", outDir, "--seed", "42"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  strictEqual(r.json.images, 3);
  strictEqual(r.json.captions, 3);
  strictEqual(r.json.seeded, true);
});

test("cli: psycho-build missing manifest arg returns CliError", () => {
  const r = runCli(["psycho-build"]);
  strictEqual(r.status, 1);
  ok(r.errorJson);
  match(r.errorJson.error, /Usage: capcut-david psycho-build/);
});

test("cli: psycho-build nonexistent manifest returns CliError", () => {
  const r = runCli(["psycho-build", "/no/such/manifest.yaml"]);
  strictEqual(r.status, 1);
  ok(r.errorJson);
  match(r.errorJson.error, /Manifest not found/);
});

// =============================================================
// CapCut visibility — psycho-build must emit draft_meta_info.json
// and draft_info.json so CapCut can index the draft.
// (Bug #1 from master plan §Post-1.0 bugs discovered.)
// =============================================================

test("e2e: psychoBuild emits draft_meta_info.json with required CapCut fields", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "paranoia-spiral");
  const result = psychoBuild(manifest, outDir, "42");

  const metaPath = resolve(result.draftPath, "draft_meta_info.json");
  ok(existsSync(metaPath), "draft_meta_info.json should be emitted alongside draft_content.json");
  strictEqual(result.metaInfoPath, metaPath, "result should expose metaInfoPath");

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  strictEqual(typeof meta.draft_id, "string");
  ok(meta.draft_id.length > 0);
  strictEqual(meta.draft_name, "paranoia-spiral");
  strictEqual(meta.draft_fold_path, outDir);
  strictEqual(meta.draft_root_path, dirname(outDir));
  strictEqual(meta.tm_duration, 9_000_000, "tm_duration should match total_duration_us");
  ok(typeof meta.tm_draft_create === "number" && meta.tm_draft_create > 0);
  ok(typeof meta.tm_draft_modified === "number" && meta.tm_draft_modified > 0);
  strictEqual(meta.draft_new_version, "164.0.0");
  ok(Array.isArray(meta.draft_materials));
});

test("e2e: psychoBuild emits draft_info.json with canvas_config + config block", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "paranoia-spiral");
  const result = psychoBuild(manifest, outDir, "42");

  const infoPath = resolve(result.draftPath, "draft_info.json");
  ok(existsSync(infoPath), "draft_info.json should be emitted alongside draft_content.json");
  strictEqual(result.draftInfoPath, infoPath, "result should expose draftInfoPath");

  const info = JSON.parse(readFileSync(infoPath, "utf-8"));
  ok(info.canvas_config, "draft_info.json must contain canvas_config");
  strictEqual(info.canvas_config.width, 1080);
  strictEqual(info.canvas_config.height, 1920);
  strictEqual(info.canvas_config.ratio, "original");
  ok(info.config, "draft_info.json must contain config block");
  strictEqual(typeof info.config.adjust_max_index, "number");
  strictEqual(typeof info.config.maintrack_adsorb, "boolean");
});

test("e2e: emitted draft_meta_info.json id matches draft_content.json id (case-insensitive)", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "out-id-match");
  const result = psychoBuild(manifest, outDir, "stable-seed");

  const draft = JSON.parse(readFileSync(result.filePath, "utf-8"));
  const meta = JSON.parse(readFileSync(result.metaInfoPath, "utf-8"));
  const info = JSON.parse(readFileSync(result.draftInfoPath, "utf-8"));
  strictEqual(meta.draft_id.toLowerCase(), draft.id.toLowerCase(), "draft_meta_info.draft_id must match draft_content.id");
  strictEqual(info.id.toLowerCase(), draft.id.toLowerCase(), "draft_info.id must match draft_content.id");
});

test("e2e: psychoBuild without registerOpt does not touch root_meta_info.json", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "no-register");
  const projectsRoot = resolve(tmp, "fake-projects-root");
  mkdirSync(projectsRoot, { recursive: true });
  const rootPath = resolve(projectsRoot, "root_meta_info.json");
  // Pre-seed an empty root so we can detect any unwanted writes.
  writeFileSync(rootPath, JSON.stringify({ all_draft_store: [], draft_ids: [], root_path: projectsRoot }), "utf-8");

  const before = readFileSync(rootPath, "utf-8");
  const result = psychoBuild(manifest, outDir, "42");
  const after = readFileSync(rootPath, "utf-8");
  strictEqual(after, before, "root_meta_info.json must remain untouched without --register");
  strictEqual(result.registered, false, "result.registered should be false by default");
});

test("e2e: psychoBuild with registerOpt registers draft in root_meta_info.json", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "with-register");
  const projectsRoot = resolve(tmp, "fake-projects-root");
  mkdirSync(projectsRoot, { recursive: true });

  const result = psychoBuild(manifest, outDir, "42", { register: true, projectsRoot });
  strictEqual(result.registered, true, "result.registered should be true when --register passed");

  const root = JSON.parse(readFileSync(resolve(projectsRoot, "root_meta_info.json"), "utf-8"));
  ok(Array.isArray(root.all_draft_store));
  strictEqual(root.all_draft_store.length, 1, "should have one registered draft");
  const entry = root.all_draft_store[0];
  // draft_name is the --out basename (user-chosen draft folder name),
  // not the manifest title slug.
  strictEqual(entry.draft_name, "with-register");
  strictEqual(entry.draft_fold_path, outDir);
  strictEqual(entry.tm_duration, 9_000_000);
});

test("cli: psycho-build --register flag triggers registration", (t) => {
  const tmp = scratchDir(t);
  const manifest = copyExampleTo(tmp);
  const outDir = resolve(tmp, "build", "cli-register");
  const projectsRoot = resolve(tmp, "cli-projects-root");
  mkdirSync(projectsRoot, { recursive: true });

  const r = runCli([
    "psycho-build", manifest,
    "--out", outDir,
    "--seed", "42",
    "--register",
    "--projects-root", projectsRoot,
  ]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.registered, true);

  const root = JSON.parse(readFileSync(resolve(projectsRoot, "root_meta_info.json"), "utf-8"));
  strictEqual(root.all_draft_store.length, 1);
});
