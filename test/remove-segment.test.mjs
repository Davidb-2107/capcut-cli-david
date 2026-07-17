// Tests for v2.5.0 `remove-segment` — removes a segment from its track, drops
// the track when it becomes empty, then sweeps the now-orphaned materials via
// gc's shared plan (planGc/applyGc) — so the KEY guarantee is inherited: a
// material still referenced by ANY other segment is never deleted.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";

function makeDraft(over = {}) {
  return {
    id: "D1", name: "t", duration: 1_000_000, fps: 30,
    canvas_config: { width: 1080, height: 1920, ratio: "9:16" },
    tracks: [],
    materials: { videos: [], audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [], material_animations: [] },
    ...over,
  };
}
const txt = (id, extra = {}) => ({ id, type: "text", content: "{}", font_size: 10, text_color: "", alignment: 1, ...extra });
const vid = (id) => ({ id, path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 });
const aud = (id) => ({ id, path: "x.mp3", name: "x", type: "audio", duration: 1 });
const seg = (id, mid, refs = []) => ({ id, material_id: mid, target_timerange: { start: 0, duration: 1 }, extra_material_refs: refs });
const track = (id, type, segs) => ({ id, type, name: "", attribute: 0, segments: segs });

function writeDraftDir(t, draft) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-rmseg-test-"));
  const filePath = resolve(dir, "draft_content.json");
  writeFileSync(filePath, JSON.stringify(draft, null, 2), "utf-8");
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath };
}

// ===========================================================================
// [SAFETY] the dangerous test first — the key gc-sweep guarantee
// ===========================================================================

test("SAFETY: a material shared with ANOTHER segment is NOT deleted", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, videos: [vid("SHARED")], audios: [aud("SHARED_REF")] },
    tracks: [track("v", "video", [seg("s1", "SHARED", ["SHARED_REF"]), seg("s2", "SHARED", ["SHARED_REF"])])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["remove-segment", filePath, "s1"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.materials_removed, 0, "shared materials must survive");
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  deepStrictEqual(after.materials.videos.map((m) => m.id), ["SHARED"]);
  deepStrictEqual(after.materials.audios.map((m) => m.id), ["SHARED_REF"]);
  deepStrictEqual(after.tracks[0].segments.map((s) => s.id), ["s2"]);
});

test("CLI remove-segment: segment gone after save+reload, its material + extra refs swept", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, videos: [vid("V1"), vid("V2")], audios: [aud("A1")] },
    tracks: [track("v", "video", [seg("s1", "V1", ["A1"]), seg("s2", "V2")])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["remove-segment", filePath, "s1"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, true);
  strictEqual(r.json?.segment_id, "s1");
  strictEqual(r.json?.track_id, "v");
  strictEqual(r.json?.track_removed, false, "track still has s2");
  ok(r.json?.materials_removed >= 1, `expected >=1 removed, got ${r.json?.materials_removed}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  deepStrictEqual(after.tracks[0].segments.map((s) => s.id), ["s2"], "s1 gone, s2 kept");
  deepStrictEqual(after.materials.videos.map((m) => m.id), ["V2"], "V1 (main material) swept");
  deepStrictEqual(after.materials.audios.map((m) => m.id), [], "A1 (extra ref) swept");
});

test("CLI remove-segment: emptied track is removed (track_removed: true)", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, texts: [txt("T1")], videos: [vid("V1")] },
    tracks: [track("tt", "text", [seg("s1", "T1")]), track("v", "video", [seg("s2", "V1")])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["remove-segment", filePath, "s1"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.track_removed, true);
  strictEqual(r.json?.track_id, "tt");
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  deepStrictEqual(after.tracks.map((tr) => tr.id), ["v"], "emptied text track dropped, video track kept");
});

test("CLI remove-segment: unknown segment-id → exit 1, {error}, no write", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, videos: [vid("V1")] },
    tracks: [track("v", "video", [seg("s1", "V1")])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const before = readFileSync(filePath);
  const r = runCli(["remove-segment", filePath, "NOPE"]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error, `expected {error}, got ${r.stderr}`);
  ok(readFileSync(filePath).equals(before), "failed remove must not write");
});

test("CLI remove-segment: missing segment-id → exit 1, usage", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, videos: [vid("V1")] },
    tracks: [track("v", "video", [seg("s1", "V1")])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["remove-segment", filePath]);
  strictEqual(r.status, 1);
  ok(/remove-segment <project> <segment-id>/.test(r.stderr), `expected usage, got ${r.stderr}`);
});
