// Tests for src/commands/create.ts (compiled to dist/commands/create.js).
// Covers: init / add-video / add-audio / add-text — happy + error paths.
import { test } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, join } from "node:path";

import { addAudio, addEffect, addFilter, addText, addVideo, initDraft } from "../dist/commands/create.js";
import { loadDraft, saveDraft } from "../dist/draft.js";

import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- helpers local to this suite ----------

function makeScratchDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cli-david-scratch-"));
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

function makeScratchFile(t, filename, contents = "") {
  const dir = makeScratchDir(t);
  const fp = resolve(dir, filename);
  writeFileSync(fp, contents);
  return fp;
}

function makeTemplateDir(t) {
  // Manufacture a tiny template directory by copying minimal-draft.json into
  // it as draft_content.json — enough for initDraft() to do its cpSync + JSON
  // rewrite without touching the real CapCutAPI template.
  const dir = makeScratchDir(t);
  copyFileSync(fixturePath(FIXTURES.MINIMAL), resolve(dir, "draft_content.json"));
  return dir;
}

// =============================================================
// init / cmdInit
// =============================================================

test("init: initDraft creates a new draft directory, rewrites id+name", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const name = "my-new-draft";

  const result = initDraft({ name, templateDir, draftsDir });

  ok(result.draftPath.endsWith(name), `draftPath should end with ${name}`);
  ok(existsSync(result.filePath), "filePath should exist on disk");
  strictEqual(result.filePath, resolve(draftsDir, name, "draft_content.json"));

  const written = JSON.parse(readFileSync(result.filePath, "utf-8"));
  strictEqual(written.name, name);
  match(written.id, UUID_RE, "draft.id should be a fresh UUID");
});

test("init (CLI): missing <name> arg returns CliError with status=1", () => {
  const r = runCli(["init"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Missing name/i);
});

// Regression: Bug #2 from master plan — `init` looked for a non-existent
// `dist/CapCutAPI/template` path. After the 1.1.0 fix it must default to the
// bundled `templates/minimal/` and work without --template.
test("init (CLI): defaults to bundled template when --template is omitted", (t) => {
  const draftsDir = makeScratchDir(t);
  const name = "default-template-init";
  // Provide --drafts but NOT --template — exercises the default template path.
  const r = runCli(["init", name, "--drafts", draftsDir]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);

  const draftPath = resolve(draftsDir, name);
  ok(existsSync(draftPath), "draft dir should be created in draftsDir");
  ok(
    existsSync(resolve(draftPath, "draft_content.json")),
    "default template must populate draft_content.json"
  );
});

test("init: initDraft throws when target draft directory already exists", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const name = "already-here";

  // Pre-create the destination to trigger the "already exists" branch.
  mkdirSync(resolve(draftsDir, name), { recursive: true });

  let caught;
  try {
    initDraft({ name, templateDir, draftsDir });
  } catch (e) {
    caught = e;
  }
  ok(caught, "expected initDraft to throw on existing draft path");
  match(String(caught.message), /already exists/i);
});

// =============================================================
// add-video / addVideo
// =============================================================

test("add-video: addVideo registers material, track, segment and copies asset", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const tracksBefore = draft.tracks.length;
  const videosBefore = draft.materials.videos.length;

  const srcVideo = makeScratchFile(t, "test-video.mp4", "fake-mp4-bytes");

  const result = addVideo(draft, filePath, {
    path: srcVideo,
    start: 0,
    duration: 1_000_000,
  });

  match(result.segmentId, UUID_RE);
  match(result.materialId, UUID_RE);
  match(result.trackId, UUID_RE);

  // Track + material bookkeeping
  strictEqual(draft.tracks.length, tracksBefore + 1, "should add one video track");
  const videoTrack = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(videoTrack, "new video track should be findable by id");
  strictEqual(videoTrack.type, "video");
  strictEqual(videoTrack.segments.length, 1);
  strictEqual(videoTrack.segments[0].id, result.segmentId);

  strictEqual(draft.materials.videos.length, videosBefore + 1);
  const mat = draft.materials.videos.find((m) => m.id === result.materialId);
  ok(mat, "video material should be present");
  // Production code does `opts.path.split("/").pop()` which on Windows returns
  // the full path (no '/' separators). Normalize for the assertion.
  strictEqual(basename(mat.material_name), "test-video.mp4");
  strictEqual(mat.type, "video"); // .mp4 is not in the image-ext list

  // v2.0.0: material.path is a portable placeholder token into Resources/
  // (rename-safe); the copied file lives at <draftDir>/Resources/<matId>.mp4.
  ok(mat.path.startsWith("##_draftpath_placeholder_"), `material.path should be a token: ${mat.path}`);
  ok(existsSync(resolve(dirname(filePath), "Resources", `${result.materialId}.mp4`)), "copied asset should exist in Resources/");

  // draft.duration extension branch
  strictEqual(draft.duration, 1_000_000, "duration should extend to segEnd");

  // Persistence: save and re-load
  saveDraft(filePath, draft);
  const { draft: reloaded } = loadDraft(filePath);
  ok(
    reloaded.materials.videos.some((m) => m.id === result.materialId),
    "material should persist through save+load",
  );
  ok(
    reloaded.tracks.some((tr) => tr.id === result.trackId),
    "track should persist through save+load",
  );
});

test("add-video (CLI): missing args returns CliError 'Missing arguments'", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  // Only project path — no file/start/duration → requireArgs trips in index.ts.
  const r = runCli(["add-video", fixture]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Usage: capcut-david add-video|Missing arguments/i);
});

// =============================================================
// add-audio / addAudio
// =============================================================

test("add-audio: addAudio registers material, track, segment with custom volume", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const tracksBefore = draft.tracks.length;
  const audiosBefore = draft.materials.audios.length;

  const srcAudio = makeScratchFile(t, "test-audio.mp3", "fake-mp3-bytes");

  const result = addAudio(draft, filePath, {
    path: srcAudio,
    start: 0,
    duration: 2_000_000,
    volume: 0.5,
  });

  match(result.segmentId, UUID_RE);
  match(result.materialId, UUID_RE);
  match(result.trackId, UUID_RE);

  strictEqual(draft.tracks.length, tracksBefore + 1);
  const audioTrack = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(audioTrack);
  strictEqual(audioTrack.type, "audio");
  strictEqual(audioTrack.segments.length, 1);
  strictEqual(audioTrack.segments[0].volume, 0.5, "volume kwarg should land on the segment");

  strictEqual(draft.materials.audios.length, audiosBefore + 1);
  const mat = draft.materials.audios.find((m) => m.id === result.materialId);
  ok(mat);
  // Production `opts.path.split("/").pop()` doesn't handle Windows backslashes;
  // assert via basename so the test is cross-platform.
  strictEqual(basename(mat.name), "test-audio.mp3");
  strictEqual(mat.duration, 2_000_000);

  // v2.0.0: material.path is a portable placeholder token into Resources/.
  ok(mat.path.startsWith("##_draftpath_placeholder_"), `material.path should be a token: ${mat.path}`);
  ok(existsSync(resolve(dirname(filePath), "Resources", `${result.materialId}.mp3`)), "copied asset should exist in Resources/");

  // Persistence
  saveDraft(filePath, draft);
  const { draft: reloaded } = loadDraft(filePath);
  ok(reloaded.materials.audios.some((m) => m.id === result.materialId));
  strictEqual(reloaded.duration, 2_000_000);
});

test("add-audio (CLI): missing args returns CliError 'Missing arguments'", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  const r = runCli(["add-audio", fixture]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Usage: capcut-david add-audio|Missing arguments/i);
});

// =============================================================
// add-text / addText
// =============================================================

test("add-text: addText writes text material w/ #FF0000 color and parseable content", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const textsBefore = draft.materials.texts.length;

  const result = addText(draft, filePath, {
    text: "Test caption",
    start: 0,
    duration: 2_000_000,
    fontSize: 24,
    color: "#FF0000",
    alignment: 1,
  });

  match(result.segmentId, UUID_RE);
  match(result.materialId, UUID_RE);
  match(result.trackId, UUID_RE);

  strictEqual(draft.materials.texts.length, textsBefore + 1);
  const mat = draft.materials.texts.find((m) => m.id === result.materialId);
  ok(mat, "text material should be present");
  strictEqual(mat.text_color, "#FF0000");
  strictEqual(mat.font_size, 24);
  strictEqual(mat.alignment, 1);

  // content is JSON with text + 1 styles entry; range derived from utf16le buffer length.
  const parsed = JSON.parse(mat.content);
  strictEqual(parsed.text, "Test caption");
  ok(Array.isArray(parsed.styles));
  strictEqual(parsed.styles.length, 1);
  const utf16Len = Buffer.from("Test caption", "utf16le").length;
  strictEqual(parsed.styles[0].range[1], utf16Len, "styles[0].range[1] should equal utf16le buffer length");
  strictEqual(parsed.styles[0].size, 24);

  // hexToRgb applied: #FF0000 → [1, 0, 0]
  const rgb = parsed.styles[0].fill.content.solid.color;
  strictEqual(rgb[0], 1);
  strictEqual(rgb[1], 0);
  strictEqual(rgb[2], 0);

  // Persistence
  saveDraft(filePath, draft);
  const { draft: reloaded } = loadDraft(filePath);
  ok(reloaded.materials.texts.some((m) => m.id === result.materialId));
});

test("add-text: addText with custom trackName creates a new text track", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);

  const textTracksBefore = draft.tracks.filter((tr) => tr.type === "text").length;

  const result = addText(draft, filePath, {
    text: "Brand-new caption",
    start: 0,
    duration: 1_000_000,
    trackName: "my-unique-track-name-xyz",
  });

  const textTracksAfter = draft.tracks.filter((tr) => tr.type === "text").length;
  strictEqual(
    textTracksAfter,
    textTracksBefore + 1,
    "a fresh text track should be created when trackName doesn't match existing",
  );
  const newTrack = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(newTrack);
  strictEqual(newTrack.name, "my-unique-track-name-xyz");
  strictEqual(newTrack.segments.length, 1);
});

test("add-text (CLI): missing <text> arg returns CliError 'Missing arguments'", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  // Only project + start + duration — no text → requireArgs trips in index.ts
  // before cmdAddText runs (it requires >=5 positional incl. cmd+project).
  const r = runCli(["add-text", fixture, "0", "1s"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Missing (text|arguments)/i);
});

// =============================================================
// CLI happy paths (exercise cmdAddVideo / cmdAddAudio / cmdAddText wrappers)
// =============================================================

test("add-text (CLI happy): spawns, writes JSON to stdout, persists to disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "1s", "Hello", "from", "CLI"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  match(r.json.segment_id, UUID_RE);
  match(r.json.material_id, UUID_RE);
  match(r.json.track_id, UUID_RE);
  strictEqual(r.json.text, "Hello from CLI");
  strictEqual(r.json.start_us, 0);
  strictEqual(r.json.duration_us, 1_000_000);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(after.materials.texts.some((m) => m.id === r.json.material_id));
  ok(after.tracks.some((tr) => tr.id === r.json.track_id));
});

test("add-audio (CLI happy): spawns with --volume, persists, returns JSON", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const scratchDir = makeScratchDir(t);
  const srcAudio = resolve(scratchDir, "cli-audio.mp3");
  writeFileSync(srcAudio, "fake-mp3-bytes");

  // The cmd's `audioPath.startsWith("/")` check is POSIX-flavored; on Windows
  // an absolute path starts with a drive letter, so the cmd prepends cwd.
  // Set cwd to the scratch dir and pass just the filename for cross-platform.
  const r = runCli(["add-audio", filePath, "cli-audio.mp3", "0", "2s", "--volume", "0.3"], {
    cwd: scratchDir,
  });
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  match(r.json.segment_id, UUID_RE);
  strictEqual(r.json.duration_us, 2_000_000);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const seg = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === r.json.segment_id);
  ok(seg, "segment should be persisted");
  strictEqual(seg.volume, 0.3);
});

test("add-video (CLI happy): spawns, persists, returns JSON", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const scratchDir = makeScratchDir(t);
  const srcVid = resolve(scratchDir, "cli-video.mp4");
  writeFileSync(srcVid, "fake-mp4-bytes");

  const r = runCli(["add-video", filePath, "cli-video.mp4", "0", "1.5s"], {
    cwd: scratchDir,
  });
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  match(r.json.segment_id, UUID_RE);
  strictEqual(r.json.duration_us, 1_500_000);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(after.materials.videos.some((m) => m.id === r.json.material_id));
});

test("add-video: .png extension uses materialType='photo'", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const srcImg = makeScratchFile(t, "frame.png", "fake-png");

  const result = addVideo(draft, filePath, {
    path: srcImg,
    start: 0,
    duration: 500_000,
  });
  const mat = draft.materials.videos.find((m) => m.id === result.materialId);
  strictEqual(mat.type, "photo", ".png should map to photo materialType");
  strictEqual(mat.has_audio, false, "photo materials should have has_audio=false");
});

// =============================================================
// add-effect / addEffect
// =============================================================

const VHS_HORROR_ID = "7583016187584417032";

test("add-effect: registers video_effect material + effect track + segment", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const effectsBefore = draft.materials.video_effects?.length ?? 0;
  const tracksBefore = draft.tracks.length;

  const result = addEffect(draft, filePath, {
    resourceId: VHS_HORROR_ID,
    name: "VHS Horror",
    start: 0,
    duration: 5_000_000,
  });

  match(result.segmentId, UUID_RE);
  match(result.materialId, UUID_RE);
  match(result.trackId, UUID_RE);

  strictEqual(draft.tracks.length, tracksBefore + 1, "should add one effect track");
  const effectTrack = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(effectTrack, "effect track should be findable by id");
  strictEqual(effectTrack.type, "effect");
  strictEqual(effectTrack.segments.length, 1);
  strictEqual(effectTrack.segments[0].id, result.segmentId);

  const seg = effectTrack.segments[0];
  strictEqual(seg.material_id, result.materialId);
  strictEqual(seg.target_timerange.start, 0);
  strictEqual(seg.target_timerange.duration, 5_000_000);
  strictEqual(seg.clip, null, "effect segment should have null clip");

  strictEqual(
    (draft.materials.video_effects ?? []).length,
    effectsBefore + 1,
    "should add one video_effect material",
  );
  const mat = (draft.materials.video_effects ?? []).find((m) => m.id === result.materialId);
  ok(mat, "video_effect material should be present");
  strictEqual(mat.name, "VHS Horror");
  strictEqual(mat.resource_id, VHS_HORROR_ID);
  strictEqual(mat.type, "video_effect");
  strictEqual(mat.value, 1.0);
  strictEqual(mat.apply_target_type, 2, "default should be global/track-wide");

  // Persistence
  saveDraft(filePath, draft);
  const { draft: reloaded } = loadDraft(filePath);
  ok(
    reloaded.materials.video_effects?.some((m) => m.id === result.materialId),
    "video_effect material should persist through save+load",
  );
  ok(
    reloaded.tracks.some((tr) => tr.id === result.trackId),
    "effect track should persist through save+load",
  );
});

test("add-effect: with --bind creates segment-specific effect (apply_target_type=0)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const { draft } = loadDraft(filePath);

  const firstSegId = draft.tracks.find((tr) => tr.type === "video")?.segments[0]?.id;
  ok(firstSegId, "fixture should have at least one video segment to bind to");

  const result = addEffect(draft, filePath, {
    resourceId: VHS_HORROR_ID,
    name: "VHS Horror",
    start: 0,
    duration: 3_000_000,
    bindSegmentId: firstSegId,
  });

  const mat = (draft.materials.video_effects ?? []).find((m) => m.id === result.materialId);
  ok(mat);
  strictEqual(mat.apply_target_type, 0, "bound effect should have apply_target_type=0");
  strictEqual(mat.bind_segment_id, firstSegId, "bind_segment_id should match");
});

test("add-effect: custom --value is written to material", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const result = addEffect(draft, filePath, {
    resourceId: VHS_HORROR_ID,
    name: "VHS Horror",
    start: 0,
    duration: 3_000_000,
    value: 0.5,
  });

  const mat = (draft.materials.video_effects ?? []).find((m) => m.id === result.materialId);
  ok(mat);
  strictEqual(mat.value, 0.5, "value should be 0.5");
});

test("add-effect (CLI happy): spawns, writes JSON, persists to disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-effect", filePath, VHS_HORROR_ID, "VHS Horror", "0", "5s"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  match(r.json.segment_id, UUID_RE);
  match(r.json.material_id, UUID_RE);
  match(r.json.track_id, UUID_RE);
  strictEqual(r.json.resource_id, VHS_HORROR_ID);
  strictEqual(r.json.name, "VHS Horror");
  strictEqual(r.json.value, 1.0);
  strictEqual(r.json.start_us, 0);
  strictEqual(r.json.duration_us, 5_000_000);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(
    after.materials.video_effects?.some((m) => m.id === r.json.material_id),
    "video_effect material should be persisted",
  );
  ok(
    after.tracks.some((tr) => tr.id === r.json.track_id),
    "effect track should be persisted",
  );
});

test("add-effect (CLI): missing args returns error", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  const r = runCli(["add-effect", fixture]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Usage: capcut-david add-effect/i);
});

test("add-effect (CLI): --value out of range returns error", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  const r = runCli(["add-effect", fixture, VHS_HORROR_ID, "Test", "0", "3s", "--value", "2.5"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--value must be a number in range/i);
});

// =============================================================
// add-filter / addFilter
// =============================================================

const WESTERN_ID = "7083809725615247874";

test("add-filter: registers filter material in materials.effects + filter track + segment", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const effectsBefore = draft.materials.effects?.length ?? 0;
  const tracksBefore = draft.tracks.length;

  const result = addFilter(draft, filePath, {
    resourceId: WESTERN_ID,
    name: "Western",
    start: 0,
    duration: 5_000_000,
  });

  match(result.segmentId, UUID_RE);
  match(result.materialId, UUID_RE);
  match(result.trackId, UUID_RE);

  strictEqual(draft.tracks.length, tracksBefore + 1, "should add one filter track");
  const filterTrack = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(filterTrack, "filter track should be findable by id");
  strictEqual(filterTrack.type, "filter");
  strictEqual(filterTrack.segments.length, 1);
  strictEqual(filterTrack.segments[0].id, result.segmentId);

  const seg = filterTrack.segments[0];
  strictEqual(seg.material_id, result.materialId);
  strictEqual(seg.target_timerange.start, 0);
  strictEqual(seg.target_timerange.duration, 5_000_000);
  strictEqual(seg.render_index, 10000, "filter segments use render_index 10000");

  strictEqual(
    (draft.materials.effects ?? []).length,
    effectsBefore + 1,
    "should add one filter material to materials.effects",
  );
  const mat = (draft.materials.effects ?? []).find((m) => m.id === result.materialId);
  ok(mat, "filter material should be present in materials.effects");
  strictEqual(mat.name, "Western");
  strictEqual(mat.resource_id, WESTERN_ID);
  strictEqual(mat.effect_id, WESTERN_ID);
  strictEqual(mat.type, "filter", "material type must be filter, not video_effect");
  strictEqual(mat.sub_type, "none");
  strictEqual(mat.value, 1.0);
  strictEqual(mat.apply_target_type, 0, "CapCut writes apply_target_type=0 for filters");
  strictEqual(mat.category_name, "Filters");

  // Persistence
  saveDraft(filePath, draft);
  const { draft: reloaded } = loadDraft(filePath);
  ok(
    reloaded.materials.effects?.some((m) => m.id === result.materialId),
    "filter material should persist through save+load",
  );
  ok(
    reloaded.tracks.some((tr) => tr.id === result.trackId),
    "filter track should persist through save+load",
  );
});

test("add-filter: custom --value is written to material", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const result = addFilter(draft, filePath, {
    resourceId: WESTERN_ID,
    name: "Western",
    start: 0,
    duration: 3_000_000,
    value: 0.5,
  });

  const mat = (draft.materials.effects ?? []).find((m) => m.id === result.materialId);
  ok(mat);
  strictEqual(mat.value, 0.5, "value should be 0.5");
});

test("add-filter: reuses an existing filter track", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);

  const first = addFilter(draft, filePath, {
    resourceId: WESTERN_ID,
    name: "Western",
    start: 0,
    duration: 1_000_000,
  });
  const second = addFilter(draft, filePath, {
    resourceId: WESTERN_ID,
    name: "Western",
    start: 1_000_000,
    duration: 1_000_000,
  });

  strictEqual(first.trackId, second.trackId, "second filter should land on the same track");
  const track = draft.tracks.find((tr) => tr.id === first.trackId);
  strictEqual(track.segments.length, 2);
});

test("add-filter (CLI happy): spawns, writes JSON, persists to disk", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-filter", filePath, WESTERN_ID, "Western", "0", "5s"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  ok(r.json, `expected JSON on stdout, got: ${r.stdout}`);
  strictEqual(r.json.ok, true);
  match(r.json.segment_id, UUID_RE);
  match(r.json.material_id, UUID_RE);
  match(r.json.track_id, UUID_RE);
  strictEqual(r.json.resource_id, WESTERN_ID);
  strictEqual(r.json.name, "Western");
  strictEqual(r.json.value, 1.0);
  strictEqual(r.json.start_us, 0);
  strictEqual(r.json.duration_us, 5_000_000);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(
    after.materials.effects?.some((m) => m.id === r.json.material_id),
    "filter material should be persisted",
  );
  ok(
    after.tracks.some((tr) => tr.id === r.json.track_id && tr.type === "filter"),
    "filter track should be persisted",
  );
});

test("add-filter (CLI): missing args returns error", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  const r = runCli(["add-filter", fixture]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Usage: capcut-david add-filter/i);
});

test("add-filter (CLI): --value out of range returns error", () => {
  const fixture = fixturePath(FIXTURES.MINIMAL);
  const r = runCli(["add-filter", fixture, WESTERN_ID, "Test", "0", "3s", "--value", "2.5"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--value must be a number in range/i);
});

// =============================================================
// init --width/--height (v2.1.0)
// =============================================================

test("initDraft rewrites canvas_config when width+height given", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const { filePath } = initDraft({ name: "portrait", templateDir, draftsDir, width: 1080, height: 1920 });
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  strictEqual(content.canvas_config.width, 1080);
  strictEqual(content.canvas_config.height, 1920);
});

test("initDraft keeps template canvas when width/height omitted", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const { filePath } = initDraft({ name: "landscape", templateDir, draftsDir });
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  strictEqual(content.canvas_config.width, 1920);
  strictEqual(content.canvas_config.height, 1080);
});

test("CLI: init dies on one-sided --width", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const r = runCli(["init", "onesided", "--template", templateDir, "--drafts", draftsDir, "--width", "1080"]);
  strictEqual(r.status, 1);
  match(r.stderr, /--width and --height must be given together/);
});

test("CLI: init dies on NaN --width", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const r = runCli(["init", "bad", "--template", templateDir, "--drafts", draftsDir, "--width", "abc", "--height", "1920"]);
  strictEqual(r.status, 1);
  match(r.stderr, /positive integers/);
});

test("CLI: init dies on non-positive --height", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const r = runCli(["init", "neg", "--template", templateDir, "--drafts", draftsDir, "--width", "1080", "--height", "0"]);
  strictEqual(r.status, 1);
  match(r.stderr, /positive integers/);
});
