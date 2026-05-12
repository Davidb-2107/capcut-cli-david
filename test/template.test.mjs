// Tests for src/commands/template.ts → dist/commands/template.js
// Covers: save-template (cmdSaveTemplate / saveTemplate)
//         apply-template (cmdApplyTemplate / applyTemplate)
import { test } from "node:test";
import { ok, strictEqual, deepStrictEqual, throws, notStrictEqual } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveTemplate, applyTemplate } from "../dist/commands/template.js";
import { loadFixture, FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tplDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-tpl-"));
  if (t && typeof t.after === "function") {
    t.after(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// saveTemplate — happy paths
// ---------------------------------------------------------------------------

test("saveTemplate: video segment from KEN_BURNS produces template with resolved extras", (t) => {
  const draft = loadFixture(FIXTURES.KEN_BURNS);
  const videoTrack = draft.tracks.find((tr) => tr.type === "video");
  const seg = videoTrack.segments[0];
  ok(seg.extra_material_refs.length > 0, "fixture must have extras for this test");

  const outPath = join(tplDir(t), "ken-burns-zoom.json");
  const result = saveTemplate(draft, seg.id, "my-zoom", outPath);

  strictEqual(result.name, "my-zoom");
  strictEqual(result.type, "video");
  ok(result.segment, "template.segment must exist");
  strictEqual(result.segment.id, seg.id);
  strictEqual(result.material.type, "videos");
  strictEqual(typeof result.material.data, "object");
  // every extra_material_ref must have resolved
  strictEqual(result.extra_materials.length, seg.extra_material_refs.length);
  for (const ex of result.extra_materials) {
    strictEqual(typeof ex.type, "string");
    strictEqual(typeof ex.data, "object");
    ok(typeof ex.data.id === "string");
  }

  // File written to disk and matches return value.
  const onDisk = JSON.parse(readFileSync(outPath, "utf-8"));
  strictEqual(onDisk.name, "my-zoom");
  strictEqual(onDisk.type, "video");
  strictEqual(onDisk.material.type, "videos");
  strictEqual(onDisk.extra_materials.length, result.extra_materials.length);
});

test("saveTemplate: text segment from SUBTITLES exercises text/material branch", (t) => {
  const draft = loadFixture(FIXTURES.SUBTITLES);
  const textTrack = draft.tracks.find((tr) => tr.type === "text");
  const seg = textTrack.segments[0];

  const outPath = join(tplDir(t), "text-style.json");
  const result = saveTemplate(draft, seg.id, "caption-style", outPath);

  strictEqual(result.type, "text");
  strictEqual(result.material.type, "texts");
  // The text material's content is JSON; just verify it's a string.
  strictEqual(typeof result.material.data.content, "string");
  strictEqual(result.segment.id, seg.id);

  const onDisk = JSON.parse(readFileSync(outPath, "utf-8"));
  strictEqual(onDisk.material.type, "texts");
});

test("saveTemplate: prefix match resolves the full segment id", (t) => {
  const draft = loadFixture(FIXTURES.KEN_BURNS);
  const videoTrack = draft.tracks.find((tr) => tr.type === "video");
  const seg = videoTrack.segments[0];
  const prefix = seg.id.slice(0, 8); // first 8 chars

  const outPath = join(tplDir(t), "prefix.json");
  const result = saveTemplate(draft, prefix, "prefix-test", outPath);
  strictEqual(result.segment.id, seg.id);
});

// ---------------------------------------------------------------------------
// saveTemplate — error paths
// ---------------------------------------------------------------------------

test("saveTemplate: unknown segment id throws 'Segment not found'", (t) => {
  const draft = loadFixture(FIXTURES.KEN_BURNS);
  const outPath = join(tplDir(t), "nope.json");
  throws(
    () => saveTemplate(draft, "nonexistent-id-zzz", "x", outPath),
    /Segment not found/,
  );
});

test("cmdSaveTemplate via CLI: missing --out exits 1 with error JSON", (t) => {
  const { filePath } = tmpDraft(FIXTURES.KEN_BURNS, t);
  const draft = loadFixture(FIXTURES.KEN_BURNS);
  const seg = draft.tracks.find((tr) => tr.type === "video").segments[0];

  const r = runCli(["save-template", filePath, seg.id, "no-out-flag"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, "expected JSON error on stderr");
  ok(/Missing --out/.test(r.errorJson.error), `stderr was: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// applyTemplate — happy paths
// ---------------------------------------------------------------------------

test("applyTemplate: video template applied to MINIMAL → fresh IDs + remapped extras", (t) => {
  // 1. Build template from KEN_BURNS video segment.
  const sourceDraft = loadFixture(FIXTURES.KEN_BURNS);
  const seg = sourceDraft.tracks.find((tr) => tr.type === "video").segments[0];
  const dir = tplDir(t);
  const templatePath = join(dir, "video-tpl.json");
  saveTemplate(sourceDraft, seg.id, "video-tpl", templatePath);
  const templateJson = JSON.parse(readFileSync(templatePath, "utf-8"));
  const originalSegId = templateJson.segment.id;
  const originalMatId = templateJson.material.data.id;
  const originalExtraIds = templateJson.extra_materials.map((e) => e.data.id);

  // 2. Apply to MINIMAL.
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));
  const start = 0;
  const duration = 2_000_000;
  const result = applyTemplate(draft, templatePath, start, duration);

  // 3. Fresh UUIDs returned.
  ok(UUID_RE.test(result.segmentId), `segmentId not uuid: ${result.segmentId}`);
  ok(UUID_RE.test(result.materialId), `materialId not uuid: ${result.materialId}`);
  ok(UUID_RE.test(result.trackId), `trackId not uuid: ${result.trackId}`);
  notStrictEqual(result.segmentId, originalSegId);
  notStrictEqual(result.materialId, originalMatId);

  // 4. Draft has a track of template type containing the new segment.
  const track = draft.tracks.find((tr) => tr.id === result.trackId);
  ok(track, "new track must exist in draft");
  strictEqual(track.type, "video");
  const newSeg = track.segments.find((s) => s.id === result.segmentId);
  ok(newSeg, "new segment must be on track");
  strictEqual(newSeg.material_id, result.materialId);
  deepStrictEqual(newSeg.target_timerange, { start, duration });

  // 5. Material bucket exists and contains the new material with the new id.
  ok(Array.isArray(draft.materials.videos));
  ok(draft.materials.videos.some((m) => m.id === result.materialId));

  // 6. extra_material_refs in the new segment do NOT include any original ID.
  for (const ref of newSeg.extra_material_refs) {
    ok(!originalExtraIds.includes(ref), `leaked original extra id: ${ref}`);
    ok(ref !== originalSegId && ref !== originalMatId);
  }
  strictEqual(newSeg.extra_material_refs.length, originalExtraIds.length);
});

test("applyTemplate: text override updates material.content text + style range", (t) => {
  const sourceDraft = loadFixture(FIXTURES.SUBTITLES);
  const seg = sourceDraft.tracks.find((tr) => tr.type === "text").segments[0];
  const dir = tplDir(t);
  const templatePath = join(dir, "text-tpl.json");
  saveTemplate(sourceDraft, seg.id, "text-tpl", templatePath);

  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));

  const overrideText = "HELLO WORLD";
  const result = applyTemplate(draft, templatePath, 0, 1_000_000, { text: overrideText });

  const newMat = draft.materials.texts.find((m) => m.id === result.materialId);
  ok(newMat, "text material must be inserted");
  // content should still be JSON parseable with overridden text + recomputed range.
  const parsed = JSON.parse(newMat.content);
  strictEqual(parsed.text, overrideText);
  if (parsed.styles && parsed.styles.length > 0) {
    const expected = Buffer.from(overrideText, "utf16le").length;
    deepStrictEqual(parsed.styles[0].range, [0, expected]);
  }
});

test("applyTemplate: overrides.x / overrides.scaleX update clip.transform / clip.scale", (t) => {
  const sourceDraft = loadFixture(FIXTURES.KEN_BURNS);
  const seg = sourceDraft.tracks.find((tr) => tr.type === "video").segments[0];
  const dir = tplDir(t);
  const templatePath = join(dir, "clip-tpl.json");
  saveTemplate(sourceDraft, seg.id, "clip-tpl", templatePath);

  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));

  const result = applyTemplate(draft, templatePath, 0, 1_000_000, {
    x: 0.25,
    y: -0.1,
    scaleX: 1.5,
    scaleY: 1.5,
  });

  const track = draft.tracks.find((tr) => tr.id === result.trackId);
  const newSeg = track.segments.find((s) => s.id === result.segmentId);
  ok(newSeg.clip, "clip must exist on cloned segment");
  strictEqual(newSeg.clip.transform.x, 0.25);
  strictEqual(newSeg.clip.transform.y, -0.1);
  strictEqual(newSeg.clip.scale.x, 1.5);
  strictEqual(newSeg.clip.scale.y, 1.5);
});

test("applyTemplate: empty extras → falls back to createCompanionMaterials", (t) => {
  // Build a synthetic template with no extras.
  const dir = tplDir(t);
  const templatePath = join(dir, "no-extras.json");
  const synthetic = {
    name: "no-extras",
    type: "video",
    segment: {
      id: "00000000-0000-0000-0000-000000000001",
      material_id: "00000000-0000-0000-0000-000000000002",
      target_timerange: { start: 0, duration: 1_000_000 },
      source_timerange: { start: 0, duration: 1_000_000 },
      extra_material_refs: [],
      clip: { scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 }, rotation: 0, alpha: 1 },
    },
    material: {
      type: "videos",
      data: {
        id: "00000000-0000-0000-0000-000000000002",
        type: "video",
        path: "/tmp/x.mp4",
        material_name: "x",
        duration: 1_000_000,
        width: 1920,
        height: 1080,
      },
    },
    extra_materials: [],
  };
  writeFileSync(templatePath, JSON.stringify(synthetic), "utf-8");

  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));
  const result = applyTemplate(draft, templatePath, 0, 1_000_000);

  const track = draft.tracks.find((tr) => tr.id === result.trackId);
  const newSeg = track.segments.find((s) => s.id === result.segmentId);
  // Companions for "video" produce 6 ids (speed, placeholder, scm, vocal, canvas, material_color).
  ok(newSeg.extra_material_refs.length >= 4, `expected fallback companions, got ${newSeg.extra_material_refs.length}`);
  // Companion buckets should now exist on the draft.
  ok(Array.isArray(draft.materials.speeds) && draft.materials.speeds.length > 0);
  ok(Array.isArray(draft.materials.placeholder_infos) && draft.materials.placeholder_infos.length > 0);
});

// ---------------------------------------------------------------------------
// applyTemplate — error path
// ---------------------------------------------------------------------------

test("applyTemplate via CLI: non-existent template path exits 1 with ENOENT", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const bogus = join(tmpdir(), `definitely-not-here-${Date.now()}.json`);
  const r = runCli(["apply-template", filePath, bogus, "0", "1s"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, "expected JSON error on stderr");
  ok(/ENOENT/.test(r.errorJson.error), `stderr was: ${r.stderr}`);
});
