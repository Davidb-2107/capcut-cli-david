// Tests for v1.8.0 `validate` — a read-only draft linter.
//
// The detectors are PURE functions over a parsed Draft, so most tests build a
// minimal draft object in memory and call runValidate() directly — no disk.
// FS-backed checks (meta.*, timelines, assets) use a real tmp directory.
//
// Hard invariant under test throughout: validate NEVER writes a byte.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runValidate, reportExitCode } from "../dist/commands/validate.js";
import { runCli } from "./helpers/spawn-cli.mjs";

// Write an arbitrary draft object to draft_content.json in a fresh tmp dir.
// Returns { dir, filePath }. Auto-cleaned via the test context.
function writeDraft(obj, t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-test-"));
  const filePath = resolve(dir, "draft_content.json");
  writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath };
}

// ---------------------------------------------------------------------------
// makeDraft — a minimal, VALID draft. Tests mutate the returned object to
// introduce one specific defect, so a "clean" baseline must produce zero
// findings for the check under test.
// ---------------------------------------------------------------------------
function makeDraft(overrides = {}) {
  const base = {
    id: "DRAFT-0001",
    name: "test",
    duration: 5_000_000,
    fps: 30,
    canvas_config: { width: 1080, height: 1920, ratio: "9:16" },
    tracks: [],
    materials: {
      videos: [],
      audios: [],
      texts: [],
      speeds: [],
      placeholder_infos: [],
      canvases: [],
      sound_channel_mappings: [],
      vocal_separations: [],
      video_effects: [],
    },
  };
  return { ...base, ...overrides };
}

function findingsFor(report, id) {
  return report.findings.filter((f) => f.id === id);
}

// ===========================================================================
// materials.dangling_ref — segment.material_id must resolve to a real material
// (EXACT id equality, never prefix-match).
// ===========================================================================

test("dangling_ref: flags a segment whose material_id resolves to nothing", () => {
  const draft = makeDraft({
    tracks: [
      {
        id: "t1",
        type: "video",
        name: "",
        attribute: 0,
        segments: [
          {
            id: "seg1",
            material_id: "MISSING",
            target_timerange: { start: 0, duration: 1_000_000 },
            extra_material_refs: [],
          },
        ],
      },
    ],
  });

  const report = runValidate(draft, null, {});
  const hits = findingsFor(report, "materials.dangling_ref");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "error");
});

test("dangling_ref: clean draft (material present) produces no dangling finding", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "v1", path: "x.mp4", material_name: "x", type: "video", duration: 1_000_000, width: 0, height: 0 }],
      audios: [],
      texts: [],
      speeds: [],
      placeholder_infos: [],
      canvases: [],
      sound_channel_mappings: [],
      vocal_separations: [],
      video_effects: [],
    },
    tracks: [
      {
        id: "t1",
        type: "video",
        name: "",
        attribute: 0,
        segments: [{ id: "seg1", material_id: "v1", target_timerange: { start: 0, duration: 1_000_000 }, extra_material_refs: [] }],
      },
    ],
  });

  const report = runValidate(draft, null, {});
  strictEqual(findingsFor(report, "materials.dangling_ref").length, 0);
});

test("dangling_ref: a truncated/prefix id does NOT falsely resolve (exact match only)", () => {
  // findMaterialGlobal prefix-matches; validate must not. A segment pointing at
  // a 6-char prefix of a real id is a corrupt ref and must be flagged.
  const draft = makeDraft({
    materials: {
      videos: [{ id: "ABCDEF12-3456", path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [],
      sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [
      {
        id: "t1", type: "video", name: "", attribute: 0,
        segments: [{ id: "seg1", material_id: "ABCDEF", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }],
      },
    ],
  });
  strictEqual(findingsFor(runValidate(draft, null, {}), "materials.dangling_ref").length, 1);
});

// ===========================================================================
// materials.orphan_text / orphan_media — a material referenced by NO segment.
// Polarity: info (import-captions/restyle legitimately leave text leftovers).
// Scoping: ONLY typed media/text slots — never companions (speeds/canvases/…),
// which are "orphaned by design" and must not cry wolf.
// ===========================================================================

test("orphan_text: an unreferenced text material is reported as info", () => {
  const draft = makeDraft({
    materials: {
      videos: [], audios: [],
      texts: [{ id: "txt1", type: "text", content: "{}", font_size: 10, text_color: "", alignment: 1 }],
      speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [], // no segment references txt1
  });
  const hits = findingsFor(runValidate(draft, null, {}), "materials.orphan_text");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "info");
});

test("orphan_media: an unreferenced video material is reported as info", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "v1", path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [],
      sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [],
  });
  const hits = findingsFor(runValidate(draft, null, {}), "materials.orphan_media");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "info");
});

test("orphan: an UNREFERENCED COMPANION (speeds/canvas) is NOT flagged as orphan", () => {
  // Companions are created per-segment and live in non-media slots. Even when a
  // companion id is reachable by nobody, it must never surface as orphan_media.
  const draft = makeDraft({
    materials: {
      videos: [], audios: [], texts: [],
      speeds: [{ id: "sp-orphan", type: "speed", speed: 1 }],
      placeholder_infos: [], canvases: [{ id: "cv-orphan", type: "canvas_color" }],
      sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [],
  });
  const report = runValidate(draft, null, {});
  strictEqual(findingsFor(report, "materials.orphan_media").length, 0);
  strictEqual(findingsFor(report, "materials.orphan_text").length, 0);
});

test("orphan: a material reachable ONLY via extra_material_refs is not an orphan", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "v1", path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [],
      sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [
      {
        id: "t1", type: "video", name: "", attribute: 0,
        // material_id points elsewhere; v1 is only reachable through extra refs.
        segments: [{ id: "seg1", material_id: "other", target_timerange: { start: 0, duration: 1 }, extra_material_refs: ["v1"] }],
      },
    ],
    // give "other" a home so dangling_ref doesn't muddy this test
  });
  draft.materials.videos.push({ id: "other", path: "y.mp4", material_name: "y", type: "video", duration: 1, width: 0, height: 0 });
  strictEqual(findingsFor(runValidate(draft, null, {}), "materials.orphan_media").length, 0);
});

// ===========================================================================
// materials.duplicate_id — material ids are globally-unique GUIDs; a repeat
// (within a slot or across slots) is corruption. error.
// ===========================================================================

test("duplicate_id: two materials sharing an id (across slots) is an error", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "DUP", path: "a.mp4", material_name: "a", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [{ id: "DUP", path: "b.mp3", name: "b", type: "audio", duration: 1 }],
      texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [],
  });
  const hits = findingsFor(runValidate(draft, null, {}), "materials.duplicate_id");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "error");
});

test("duplicate_id: distinct ids produce no finding", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "a", path: "a.mp4", material_name: "a", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [{ id: "b", path: "b.mp3", name: "b", type: "audio", duration: 1 }],
      texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [],
  });
  strictEqual(findingsFor(runValidate(draft, null, {}), "materials.duplicate_id").length, 0);
});

// ===========================================================================
// segments.zero_duration — duration <= 0. error on a/v/text tracks (it breaks
// playback); warning on auxiliary tracks (effect/sticker/filter) where a
// zero/near-zero span is less catastrophic.
// ===========================================================================

function trackWithSeg(type, segOverrides) {
  return {
    id: `t-${type}`, type, name: "", attribute: 0,
    segments: [{ id: "seg1", material_id: "m1", extra_material_refs: [], target_timerange: { start: 0, duration: 1 }, ...segOverrides }],
  };
}

test("zero_duration: a zero-duration video segment is an error", () => {
  const draft = makeDraft({ tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 0 } })] });
  const hits = findingsFor(runValidate(draft, null, {}), "segments.zero_duration");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "error");
});

test("zero_duration: a zero-duration EFFECT segment is a warning, not an error", () => {
  const draft = makeDraft({ tracks: [trackWithSeg("effect", { target_timerange: { start: 0, duration: 0 } })] });
  const hits = findingsFor(runValidate(draft, null, {}), "segments.zero_duration");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("zero_duration: a positive-duration segment produces no finding", () => {
  const draft = makeDraft({ tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 1_000_000 } })] });
  strictEqual(findingsFor(runValidate(draft, null, {}), "segments.zero_duration").length, 0);
});

// ===========================================================================
// duration.underrun / overrun — declared draft.duration vs the latest segment
// end. Float epsilon (µs) so exact-match drafts don't trip either by rounding.
// ===========================================================================

test("duration.underrun: declared duration shorter than content is a warning", () => {
  const draft = makeDraft({
    duration: 1_000_000,
    tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 2_000_000 } })],
  });
  const hits = findingsFor(runValidate(draft, null, {}), "duration.underrun");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("duration.overrun: declared duration longer than content is info (normal after trim)", () => {
  const draft = makeDraft({
    duration: 5_000_000,
    tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 1_000_000 } })],
  });
  const hits = findingsFor(runValidate(draft, null, {}), "duration.overrun");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "info");
});

test("duration: exact match (within epsilon) trips neither under- nor overrun", () => {
  const draft = makeDraft({
    duration: 1_000_000,
    tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 1_000_000 } })],
  });
  const report = runValidate(draft, null, {});
  strictEqual(findingsFor(report, "duration.underrun").length, 0);
  strictEqual(findingsFor(report, "duration.overrun").length, 0);
});

// ===========================================================================
// companions.missing — every PRESENT extra_material_refs entry must resolve.
// warning (the slot bundle is polymorphic/positional; a missing optional slot
// is degraded, not corrupt). Resolve only present refs; assume no full bundle.
// ===========================================================================

test("companions.missing: an unresolved extra_material_refs id is a warning", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "v1", path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [
      {
        id: "t1", type: "video", name: "", attribute: 0,
        segments: [{ id: "seg1", material_id: "v1", target_timerange: { start: 0, duration: 1 }, extra_material_refs: ["GHOST"] }],
      },
    ],
  });
  const hits = findingsFor(runValidate(draft, null, {}), "companions.missing");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("companions.missing: all refs resolving (or none present) produces no finding", () => {
  const draft = makeDraft({
    materials: {
      videos: [{ id: "v1", path: "x.mp4", material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [],
      speeds: [{ id: "sp1", type: "speed", speed: 1 }],
      placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [
      {
        id: "t1", type: "video", name: "", attribute: 0,
        segments: [{ id: "seg1", material_id: "v1", target_timerange: { start: 0, duration: 1 }, extra_material_refs: ["sp1"] }],
      },
    ],
  });
  strictEqual(findingsFor(runValidate(draft, null, {}), "companions.missing").length, 0);
});

// ===========================================================================
// segments.overlap — two segments overlapping on a SINGLE video/audio track.
// warning. text/effect/overlay tracks legitimately stack → not flagged.
// ===========================================================================

function twoSegTrack(type, aStart, aDur, bStart, bDur) {
  return {
    id: `t-${type}`, type, name: "", attribute: 0,
    segments: [
      { id: "segA", material_id: "m1", extra_material_refs: [], target_timerange: { start: aStart, duration: aDur } },
      { id: "segB", material_id: "m1", extra_material_refs: [], target_timerange: { start: bStart, duration: bDur } },
    ],
  };
}

test("overlap: two overlapping video segments on one track is a warning", () => {
  const draft = makeDraft({ tracks: [twoSegTrack("video", 0, 1_000_000, 500_000, 1_000_000)] });
  const hits = findingsFor(runValidate(draft, null, {}), "segments.overlap");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("overlap: overlapping TEXT segments are legitimate (no finding)", () => {
  const draft = makeDraft({ tracks: [twoSegTrack("text", 0, 1_000_000, 500_000, 1_000_000)] });
  strictEqual(findingsFor(runValidate(draft, null, {}), "segments.overlap").length, 0);
});

test("overlap: back-to-back video segments (touching boundary) do not overlap", () => {
  const draft = makeDraft({ tracks: [twoSegTrack("video", 0, 1_000_000, 1_000_000, 1_000_000)] });
  strictEqual(findingsFor(runValidate(draft, null, {}), "segments.overlap").length, 0);
});

// ===========================================================================
// canvas.config_sanity — fps>0 (ROOT, not canvas_config.fps) and
// canvas_config.width/height > 0. warning.
// ===========================================================================

test("canvas.config_sanity: fps of 0 is a warning", () => {
  const draft = makeDraft({ fps: 0 });
  const hits = findingsFor(runValidate(draft, null, {}), "canvas.config_sanity");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("canvas.config_sanity: zero canvas width is a warning", () => {
  const draft = makeDraft({ canvas_config: { width: 0, height: 1920, ratio: "9:16" } });
  strictEqual(findingsFor(runValidate(draft, null, {}), "canvas.config_sanity").length, 1);
});

test("canvas.config_sanity: a healthy canvas + fps produces no finding", () => {
  strictEqual(findingsFor(runValidate(makeDraft(), null, {}), "canvas.config_sanity").length, 0);
});

// ===========================================================================
// Envelope: schema, summary counters, ok, exit code, strict, --id/--skip.
// ===========================================================================

function danglingDraft() {
  return makeDraft({
    tracks: [
      {
        id: "t1", type: "video", name: "", attribute: 0,
        segments: [{ id: "seg1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }],
      },
    ],
  });
}

test("envelope: clean draft → schema tag, ok true, exit 0, zero counters", () => {
  const report = runValidate(makeDraft(), null, {});
  strictEqual(report.schema, "capcut-david/validate@1");
  strictEqual(report.ok, true);
  strictEqual(reportExitCode(report), 0);
  strictEqual(report.summary.errors, 0);
  ok(report.summary.checks_run > 0);
});

test("envelope: an error finding → ok false, exit 2, errors counted", () => {
  const report = runValidate(danglingDraft(), null, {});
  strictEqual(report.ok, false);
  strictEqual(report.summary.errors, 1);
  strictEqual(reportExitCode(report), 2);
});

test("strict: a warning-only draft is ok (exit 0) by default, not-ok (exit 2) under --strict", () => {
  // declared duration underrun = a lone warning. Give the segment's material a
  // home so no dangling/orphan error muddies the "warning-only" premise.
  const draft = makeDraft({
    duration: 1_000_000,
    materials: {
      videos: [{ id: "m1", path: "x.mp4", material_name: "x", type: "video", duration: 2_000_000, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
    tracks: [trackWithSeg("video", { target_timerange: { start: 0, duration: 2_000_000 } })],
  });
  const lenient = runValidate(draft, null, {});
  strictEqual(lenient.summary.warnings >= 1, true);
  strictEqual(lenient.ok, true);
  strictEqual(reportExitCode(lenient), 0);

  const strict = runValidate(draft, null, { strict: true });
  strictEqual(strict.ok, false);
  strictEqual(reportExitCode(strict), 2);
});

test("--id: only the named check runs; others are counted as skipped", () => {
  const report = runValidate(danglingDraft(), null, { ids: ["materials.dangling_ref"] });
  strictEqual(report.summary.checks_run, 1);
  ok(report.summary.checks_skipped > 0);
  strictEqual(report.findings.every((f) => f.id === "materials.dangling_ref"), true);
});

test("--skip: the named check does not run; its findings are absent", () => {
  const report = runValidate(danglingDraft(), null, { skip: ["materials.dangling_ref"] });
  strictEqual(findingsFor(report, "materials.dangling_ref").length, 0);
  ok(report.summary.checks_skipped >= 1);
});

// ===========================================================================
// CLI integration (spawn) — exit codes 0/1/2, JSON envelope, -q, -H.
// Passing a FILE path keeps the FS meta.* checks skipped (covered separately).
// ===========================================================================

test("CLI: clean draft (file path) → exit 0 + ok:true JSON envelope", (t) => {
  const { filePath } = writeDraft(makeDraft(), t);
  const r = runCli(["validate", filePath]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, true);
  strictEqual(r.json?.schema, "capcut-david/validate@1");
});

test("CLI: a draft with an error finding → exit 2 (run succeeded, found problems)", (t) => {
  const draft = makeDraft({
    tracks: [{ id: "t1", type: "video", name: "", attribute: 0,
      segments: [{ id: "seg1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }],
  });
  const { filePath } = writeDraft(draft, t);
  const r = runCli(["validate", filePath]);
  strictEqual(r.status, 2, `stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, false);
});

test("CLI: --quiet suppresses stdout but the exit code stands", (t) => {
  const draft = makeDraft({
    tracks: [{ id: "t1", type: "video", name: "", attribute: 0,
      segments: [{ id: "seg1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }],
  });
  const { filePath } = writeDraft(draft, t);
  const r = runCli(["validate", filePath, "-q"]);
  strictEqual(r.status, 2);
  strictEqual(r.stdout.trim(), "");
});

test("CLI: -H prints a human table, not JSON", (t) => {
  const { filePath } = writeDraft(makeDraft(), t);
  const r = runCli(["validate", filePath, "-H"]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  strictEqual(r.json, undefined); // not JSON
  ok(/clean|0 error|no problem|ok/i.test(r.stdout), `expected a human summary, got: ${r.stdout}`);
});

test("CLI: a missing project → exit 1 tool failure with {error}", () => {
  const r = runCli(["validate", resolve(tmpdir(), "definitely-not-a-draft-xyz")]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error, `expected an {error} envelope, got: ${r.stderr}`);
});

test("CLI: --id runs only the named check", (t) => {
  const draft = makeDraft({
    tracks: [{ id: "t1", type: "video", name: "", attribute: 0,
      segments: [{ id: "seg1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }],
  });
  const { filePath } = writeDraft(draft, t);
  const r = runCli(["validate", filePath, "--id", "materials.dangling_ref"]);
  strictEqual(r.json?.summary.checks_run, 1);
});

// ===========================================================================
// FS checks — meta.* (auto when a DIRECTORY is passed; skipped for a bare file).
// Unit-tested through runValidate against a real tmp draft dir + a controlled
// projects-root so we never touch the dev machine's real CapCut folder.
// ===========================================================================

function setupDraftDir(t, { withMeta = true, draftId = "DID-1" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-meta-"));
  writeFileSync(resolve(dir, "draft_content.json"), JSON.stringify(makeDraft()), "utf-8");
  if (withMeta) {
    writeFileSync(resolve(dir, "draft_meta_info.json"), JSON.stringify({ draft_id: draftId, draft_name: "x" }), "utf-8");
  }
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setupProjectsRoot(t, entries = []) {
  const root = mkdtempSync(join(tmpdir(), "capcut-validate-root-"));
  writeFileSync(resolve(root, "root_meta_info.json"), JSON.stringify({ all_draft_store: entries, draft_ids: [], root_path: root }), "utf-8");
  if (t && typeof t.after === "function") t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("meta.missing: a draft dir without draft_meta_info.json is an error", (t) => {
  const dir = setupDraftDir(t, { withMeta: false });
  const report = runValidate(makeDraft(), dir, { projectsRoot: setupProjectsRoot(t) });
  const hits = findingsFor(report, "meta.missing");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "error");
});

test("meta.missing: a bare file (draftDir null) is SKIPPED, never an error", () => {
  const report = runValidate(makeDraft(), null, {});
  strictEqual(findingsFor(report, "meta.missing").length, 0);
  // and it was counted as skipped, not run
  ok(report.summary.checks_skipped >= 1);
});

test("meta.unregistered: a draft dir absent from root_meta_info is a warning", (t) => {
  const dir = setupDraftDir(t, { withMeta: true });
  const root = setupProjectsRoot(t, []); // empty store → dir is unregistered
  const report = runValidate(makeDraft(), dir, { projectsRoot: root });
  const hits = findingsFor(report, "meta.unregistered");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("meta.unregistered: a registered draft dir produces no finding", (t) => {
  const dir = setupDraftDir(t, { withMeta: true });
  const root = setupProjectsRoot(t, [{ draft_id: "DID-1", draft_fold_path: dir }]);
  const report = runValidate(makeDraft(), dir, { projectsRoot: root });
  strictEqual(findingsFor(report, "meta.unregistered").length, 0);
});

test("meta.duplicate_draft_id: same draft_id at two different fold_paths is a warning", (t) => {
  const dir = setupDraftDir(t, { withMeta: true, draftId: "DUPID" });
  const root = setupProjectsRoot(t, [
    { draft_id: "DUPID", draft_fold_path: dir },
    { draft_id: "DUPID", draft_fold_path: resolve(dir, "..", "other") },
  ]);
  const report = runValidate(makeDraft(), dir, { projectsRoot: root });
  const hits = findingsFor(report, "meta.duplicate_draft_id");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

// ===========================================================================
// assets.missing_file — opt-in (--check-assets). Absolute media path pointing
// at a nonexistent file → warning. Skips ##...## placeholder tokens + empty.
// ===========================================================================

function mediaDraft(path) {
  return makeDraft({
    materials: {
      videos: [{ id: "v1", path, material_name: "x", type: "video", duration: 1, width: 0, height: 0 }],
      audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], vocal_separations: [], video_effects: [],
    },
  });
}

test("assets.missing_file: off by default (gated) even with a bad path", () => {
  const report = runValidate(mediaDraft("C:/nope/missing.mp4"), null, {});
  strictEqual(findingsFor(report, "assets.missing_file").length, 0);
  ok(report.summary.checks_skipped >= 1);
});

test("assets.missing_file: a nonexistent absolute path under --check-assets is a warning", () => {
  const report = runValidate(mediaDraft(resolve(tmpdir(), "surely-not-here-9281.mp4")), null, { checkAssets: true });
  const hits = findingsFor(report, "assets.missing_file");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("assets.missing_file: ##...## placeholder tokens and empty paths are skipped", () => {
  const tokenReport = runValidate(mediaDraft("##_draftpath_placeholder_0_##"), null, { checkAssets: true });
  strictEqual(findingsFor(tokenReport, "assets.missing_file").length, 0);
  const emptyReport = runValidate(mediaDraft(""), null, { checkAssets: true });
  strictEqual(findingsFor(emptyReport, "assets.missing_file").length, 0);
});

test("assets.missing_file: an existing file produces no finding", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-asset-"));
  const p = resolve(dir, "real.mp4");
  writeFileSync(p, "x", "utf-8");
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  strictEqual(findingsFor(runValidate(mediaDraft(p), null, { checkAssets: true }), "assets.missing_file").length, 0);
});

// ===========================================================================
// timelines.divergence — opt-in (--check-timelines). Root draft vs
// Timelines/<guid>/draft_content.json on a CHEAP signal (duration + segment
// count). Never deep-equal. warning on divergence.
// ===========================================================================

import { mkdirSync } from "node:fs";

function draftDirWithTimeline(t, rootDraft, mirrorDraft) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-tl-"));
  writeFileSync(resolve(dir, "draft_content.json"), JSON.stringify(rootDraft), "utf-8");
  if (mirrorDraft !== undefined) {
    const tl = resolve(dir, "Timelines", "GUID-1");
    mkdirSync(tl, { recursive: true });
    writeFileSync(resolve(tl, "draft_content.json"), JSON.stringify(mirrorDraft), "utf-8");
  }
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("timelines.divergence: off unless --check-timelines (gated)", (t) => {
  const root = makeDraft({ duration: 1_000_000 });
  const dir = draftDirWithTimeline(t, root, makeDraft({ duration: 9_000_000 }));
  const report = runValidate(root, dir, { projectsRoot: setupProjectsRoot(t) });
  strictEqual(findingsFor(report, "timelines.divergence").length, 0);
});

test("timelines.divergence: diverging duration under --check-timelines is a warning", (t) => {
  const root = makeDraft({ duration: 1_000_000 });
  const dir = draftDirWithTimeline(t, root, makeDraft({ duration: 9_000_000 }));
  const report = runValidate(root, dir, { checkTimelines: true, projectsRoot: setupProjectsRoot(t) });
  const hits = findingsFor(report, "timelines.divergence");
  strictEqual(hits.length, 1);
  strictEqual(hits[0].severity, "warning");
});

test("timelines.divergence: a matching mirror produces no finding", (t) => {
  const root = makeDraft({ duration: 1_000_000 });
  const dir = draftDirWithTimeline(t, root, makeDraft({ duration: 1_000_000 }));
  const report = runValidate(root, dir, { checkTimelines: true, projectsRoot: setupProjectsRoot(t) });
  strictEqual(findingsFor(report, "timelines.divergence").length, 0);
});

test("timelines.divergence: no Timelines folder → no finding (clean)", (t) => {
  const root = makeDraft({ duration: 1_000_000 });
  const dir = draftDirWithTimeline(t, root, undefined);
  const report = runValidate(root, dir, { checkTimelines: true, projectsRoot: setupProjectsRoot(t) });
  strictEqual(findingsFor(report, "timelines.divergence").length, 0);
});

// ===========================================================================
// Read-only / byte-identity — validate must NEVER write a byte. Also: no .bak.
// ===========================================================================

import { statSync, existsSync, readFileSync } from "node:fs";

test("byte-identity: the draft file's bytes + mtime are unchanged after validate", (t) => {
  // Use a draft with findings, so every code path that could write has run.
  const draft = makeDraft({
    tracks: [{ id: "t1", type: "video", name: "", attribute: 0,
      segments: [{ id: "seg1", material_id: "MISSING", target_timerange: { start: 0, duration: 1 }, extra_material_refs: [] }] }],
  });
  const { dir, filePath } = writeDraft(draft, t);
  const before = readFileSync(filePath);
  const beforeMtime = statSync(filePath).mtimeMs;

  const r = runCli(["validate", filePath, "--check-assets"]);
  strictEqual(r.status, 2, `stderr: ${r.stderr}`);

  const after = readFileSync(filePath);
  strictEqual(after.equals(before), true, "draft bytes changed");
  strictEqual(statSync(filePath).mtimeMs, beforeMtime, "draft mtime changed");
  strictEqual(existsSync(resolve(dir, "draft_content.json.bak")), false, "validate wrote a .bak");
});

// ===========================================================================
// Robustness — a throwing check degrades to a diagnostic; unparseable JSON is a
// clean tool failure (exit 1), not a crash/stacktrace.
// ===========================================================================

test("robustness: a check that throws on a malformed draft degrades, run still completes", () => {
  // segments=null makes the segment-iterating checks throw; runValidate must
  // catch each and emit a diagnostic warning rather than blow up.
  const draft = makeDraft({ tracks: [{ id: "t1", type: "video", name: "", attribute: 0, segments: null }] });
  let report;
  // Must not throw:
  report = runValidate(draft, null, {});
  ok(report.summary.warnings >= 1, "expected at least one degraded-check diagnostic");
});

test("robustness: unparseable JSON is a clean exit-1 tool failure with {error}", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-bad-"));
  const filePath = resolve(dir, "draft_content.json");
  writeFileSync(filePath, "{ this is not json", "utf-8");
  if (t && typeof t.after === "function") t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runCli(["validate", filePath]);
  strictEqual(r.status, 1);
  ok(r.errorJson?.error, `expected an {error} envelope, got: ${r.stderr}`);
});

// ===========================================================================
// CLI directory input — exercises the dispatch's dir-vs-file detection
// (statSync(projectInput).isDirectory()) end-to-end, and that --projects-root
// is honoured for the meta.* checks (isolating from the dev's real CapCut root).
// ===========================================================================

test("CLI dir: a directory without draft_meta_info.json → meta.missing error, exit 2", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-cli-dir-"));
  writeFileSync(resolve(dir, "draft_content.json"), JSON.stringify(makeDraft()), "utf-8");
  const root = setupProjectsRoot(t, []);
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = runCli(["validate", dir, "--projects-root", root]);
  strictEqual(r.status, 2, `stderr: ${r.stderr}`);
  ok(r.json.findings.some((f) => f.id === "meta.missing" && f.severity === "error"));
});

test("CLI dir: --projects-root is honoured — a registered dir has no meta.unregistered", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-validate-cli-reg-"));
  writeFileSync(resolve(dir, "draft_content.json"), JSON.stringify(makeDraft()), "utf-8");
  writeFileSync(resolve(dir, "draft_meta_info.json"), JSON.stringify({ draft_id: "CLI-DID", draft_name: "x" }), "utf-8");
  const root = setupProjectsRoot(t, [{ draft_id: "CLI-DID", draft_fold_path: dir }]);
  if (t.after) t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = runCli(["validate", dir, "--projects-root", root]);
  strictEqual(r.status, 0, `stderr: ${r.stderr}; findings: ${JSON.stringify(r.json?.findings)}`);
  strictEqual(r.json.findings.filter((f) => f.id === "meta.unregistered").length, 0);
});
