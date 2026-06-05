// Tests for v1.10.0 `gc` — removes the segment-orphan text/video/audio
// materials that `validate` reports as info. The SAFETY invariant (verified:
// 0 material->material edges across all fixtures) is that segment-reachability
// is total reachability for those three slots — so an orphan there has no
// inbound reference and is safe to delete.
//
// The dangerous test comes FIRST: never delete a referenced material; and skip
// a text whose text_to_audio_ids names other-material ids (out-of-sample edge).
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { planGc } from "../dist/commands/gc.js";
import { collectOrphans, hasBlockingErrors } from "../dist/commands/validate.js";

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
const textTrack = (segs) => ({ id: "tt", type: "text", name: "", attribute: 0, segments: segs });
const seg = (id, mid, refs = []) => ({ id, material_id: mid, target_timerange: { start: 0, duration: 1 }, extra_material_refs: refs });

// ===========================================================================
// [SAFETY] the dangerous tests first
// ===========================================================================

test("SAFETY: a referenced material is NEVER in the gc plan (segment.material_id or extra refs)", () => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, videos: [vid("LIVE")], texts: [txt("LIVE_TXT")], audios: [aud("LIVE_AUD")] },
    tracks: [
      { id: "v", type: "video", name: "", attribute: 0, segments: [seg("s1", "LIVE", ["LIVE_AUD"])] },
      textTrack([seg("s2", "LIVE_TXT")]),
    ],
  });
  const plan = planGc(draft);
  strictEqual(plan.total, 0, `nothing referenced should be planned; got ${JSON.stringify(plan)}`);
});

test("SAFETY: a text whose text_to_audio_ids is non-empty is SKIPPED, not deleted", () => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, texts: [txt("TTS_ORPHAN", { text_to_audio_ids: ["AUD-9"] })] },
    tracks: [], // segment-orphan, but has a cross-ref → must skip
  });
  const plan = planGc(draft);
  strictEqual(plan.texts.includes("TTS_ORPHAN"), false, "must not delete a TTS-linked text");
  ok(plan.skipped_cross_ref.includes("TTS_ORPHAN"));
});

test("planGc: an unreferenced text/video/audio is planned for removal; result matches collectOrphans", () => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, texts: [txt("OT")], videos: [vid("OV")], audios: [aud("OA")] },
    tracks: [],
  });
  const plan = planGc(draft);
  deepStrictEqual(plan.texts, ["OT"]);
  deepStrictEqual(plan.videos, ["OV"]);
  deepStrictEqual(plan.audios, ["OA"]);
  strictEqual(plan.total, 3);
  // shares one definition of "orphan" with validate
  const orphans = collectOrphans(draft);
  deepStrictEqual(orphans, { texts: ["OT"], videos: ["OV"], audios: ["OA"] });
});

test("planGc: only texts/videos/audios are ever planned — companions/animations excluded", () => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, speeds: [{ id: "SP", type: "speed", speed: 1 }], material_animations: [{ id: "AN" }], canvases: [{ id: "CV" }] },
    tracks: [],
  });
  const plan = planGc(draft);
  strictEqual(plan.total, 0, "non media/text orphan slots must never be planned");
});

test("hasBlockingErrors: true on dangling_ref, true on duplicate_id, false when clean", () => {
  const clean = makeDraft({ materials: { ...makeDraft().materials, texts: [txt("A")] } });
  strictEqual(hasBlockingErrors(clean), false);

  const dangling = makeDraft({ tracks: [textTrack([seg("s", "MISSING")])] });
  strictEqual(hasBlockingErrors(dangling), true);

  const dup = makeDraft({ materials: { ...makeDraft().materials, texts: [txt("DUP")], videos: [{ ...vid("DUP") }] } });
  strictEqual(hasBlockingErrors(dup), true);
});

import { applyGc } from "../dist/commands/gc.js";
import { runCli } from "./helpers/spawn-cli.mjs";

test("applyGc: removes the planned ids from their slots, leaves all other slots intact", () => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, texts: [txt("OT"), txt("KEEP")], videos: [vid("OV")], speeds: [{ id: "SP", type: "speed", speed: 1 }] },
  });
  applyGc(draft, { texts: ["OT"], videos: ["OV"], audios: [], skipped_cross_ref: [], total: 2 });
  deepStrictEqual(draft.materials.texts.map((m) => m.id), ["KEEP"]);
  deepStrictEqual(draft.materials.videos.map((m) => m.id), []);
  deepStrictEqual(draft.materials.speeds.map((m) => m.id), ["SP"], "non-target slots untouched");
});

function writeDraftDir(t, draft) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-gc-test-"));
  const filePath = resolve(dir, "draft_content.json");
  writeFileSync(filePath, JSON.stringify(draft, null, 2), "utf-8");
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath };
}

const orphanDraft = () => makeDraft({ materials: { ...makeDraft().materials, texts: [txt("OT")], videos: [vid("OV")] }, tracks: [] });

test("CLI gc: real removal → exit 0, orphans gone, .bak created, stderr warns + names sync-timelines", (t) => {
  const { dir, filePath } = writeDraftDir(t, orphanDraft());
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.summary.removed_total, 2);
  strictEqual(r.json?.summary.wrote, true);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  strictEqual(after.materials.texts.length, 0);
  strictEqual(after.materials.videos.length, 0);
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), true);
  ok(/WARNING gc removed 2/.test(r.stderr));
  ok(/sync-timelines/.test(r.stderr));
});

test("CLI gc: clean draft → no-op, no .bak, bytes+mtime unchanged, wrote:false; 2nd run idem", (t) => {
  const clean = makeDraft({ materials: { ...makeDraft().materials, texts: [txt("LIVE")] }, tracks: [textTrack([seg("s", "LIVE")])] });
  const { dir, filePath } = writeDraftDir(t, clean);
  const before = readFileSync(filePath);
  const mtime = statSync(filePath).mtimeMs;
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.summary.wrote, false);
  ok(readFileSync(filePath).equals(before), "no-op must not rewrite the draft");
  strictEqual(statSync(filePath).mtimeMs, mtime, "no-op must not bump mtime");
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), false, "no-op must not create a .bak");
  strictEqual(/WARNING/.test(r.stderr), false);
});

test("CLI gc: --dry-run reports the plan but writes zero bytes / no .bak", (t) => {
  const { dir, filePath } = writeDraftDir(t, orphanDraft());
  const before = readFileSync(filePath);
  const r = runCli(["gc", filePath, "--dry-run"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.dry_run, true);
  strictEqual(r.json?.summary.removed_total, 2, "dry-run still reports what WOULD be removed");
  strictEqual(r.json?.summary.wrote, false);
  ok(readFileSync(filePath).equals(before), "dry-run must not write");
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), false);
});

test("CLI gc: live-text + orphan-text on one track → only the orphan is removed, live binding survives", (t) => {
  const draft = makeDraft({
    materials: { ...makeDraft().materials, texts: [txt("LIVE"), txt("ORPH")] },
    tracks: [textTrack([seg("s", "LIVE")])],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  deepStrictEqual(after.materials.texts.map((m) => m.id), ["LIVE"]);
  strictEqual(after.tracks[0].segments[0].material_id, "LIVE", "live binding intact");
});

test("CLI gc: a transition-bound segment (extra_material_refs[2]) keeps its binding; orphan text removed", (t) => {
  const draft = makeDraft({
    materials: {
      ...makeDraft().materials,
      videos: [vid("V")], texts: [txt("ORPH")],
      transitions: [{ id: "TR", type: "transition" }],
      speeds: [{ id: "SP" }], placeholder_infos: [{ id: "PH" }], canvases: [{ id: "CV" }],
    },
    tracks: [{ id: "v", type: "video", name: "", attribute: 0, segments: [seg("s", "V", ["SP", "PH", "TR", "CV"])] }],
  });
  const { filePath } = writeDraftDir(t, draft);
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  deepStrictEqual(after.materials.texts.map((m) => m.id), [], "orphan text removed");
  strictEqual(after.materials.transitions.length, 1, "transition (reachable via extra_material_refs[2]) survives");
  deepStrictEqual(after.tracks[0].segments[0].extra_material_refs, ["SP", "PH", "TR", "CV"], "positional refs untouched");
});

test("CLI gc: a draft with a duplicate material id → exit 1, no write", (t) => {
  const draft = makeDraft({ materials: { ...makeDraft().materials, texts: [txt("DUP")], videos: [{ ...vid("DUP") }] }, tracks: [] });
  const { dir, filePath } = writeDraftDir(t, draft);
  const before = readFileSync(filePath);
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error, `expected {error}, got ${r.stderr}`);
  ok(readFileSync(filePath).equals(before), "refused gc must not write");
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), false);
});

test("CLI gc: a draft with a dangling segment ref → exit 1, no write (refuse before deleting)", (t) => {
  const draft = makeDraft({ materials: { ...makeDraft().materials, texts: [txt("ORPH")] }, tracks: [textTrack([seg("s", "MISSING")])] });
  const { dir, filePath } = writeDraftDir(t, draft);
  const before = readFileSync(filePath);
  const r = runCli(["gc", filePath]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error, `expected {error}, got ${r.stderr}`);
  ok(readFileSync(filePath).equals(before), "refused gc must not write");
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), false);
});
