// Coverage for src/commands/keyframe.ts (compiled to dist/commands/keyframe.js).
// Mirrors the edit.test.mjs structure:
//   - Happy paths invoke cmdXxx directly against a tmp fixture copy.
//   - Error paths spawn the built CLI and assert exit code 1 + stderr JSON.

import { test } from "node:test";
import { strictEqual, ok, match, notStrictEqual, deepStrictEqual } from "node:assert";
import { statSync } from "node:fs";

import { cmdAddKeyframe, cmdKenBurns, PROPERTY_MAP, VALID_CURVES } from "../dist/commands/keyframe.js";
import { loadDraft } from "../dist/draft.js";

import { FIXTURES, fixturePath, loadFixture } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const flagsQuiet = { human: false, quiet: true };

function firstVideoSegment(draft) {
  for (const track of draft.tracks) {
    if (track.type === "video") {
      for (const seg of track.segments) {
        if (seg.clip) return { track, seg };
      }
    }
  }
  throw new Error("No video segment with clip in fixture");
}

// Fixture with empty common_keyframes — animations-draft has 1 video seg with hasKF=0.
const CLEAN_FIXTURE = FIXTURES.ANIMATIONS;

// ---------------------------------------------------------------------------
// add-keyframe: happy path per property
// ---------------------------------------------------------------------------

for (const [cliProp, kfType] of Object.entries(PROPERTY_MAP)) {
  test(`cmdAddKeyframe: ${cliProp} → ${kfType} creates container and keyframe`, (t) => {
    const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
    const { draft } = loadDraft(filePath);
    const { seg } = firstVideoSegment(draft);

    const value = cliProp === "alpha" ? 0.5 : cliProp === "rotation" ? 45 : 1.25;
    cmdAddKeyframe(draft, filePath, seg.id, "0", cliProp, String(value), undefined, flagsQuiet);

    const cks = seg.common_keyframes;
    ok(Array.isArray(cks), "common_keyframes is an array");
    const container = cks.find((c) => c.property_type === kfType);
    ok(container, `container for ${kfType} created`);
    strictEqual(container.keyframe_list.length, 1);
    strictEqual(container.keyframe_list[0].time_offset, 0);
    deepStrictEqual(container.keyframe_list[0].values, [value]);
    strictEqual(container.keyframe_list[0].curveType, "FreeCurveInOut");
    strictEqual(container.keyframe_list[0].string_value, "");

    // Persistence
    const { draft: after } = loadDraft(filePath);
    const segAfter = after.tracks.flatMap((tr) => tr.segments).find((s) => s.id === seg.id);
    const cAfter = segAfter.common_keyframes.find((c) => c.property_type === kfType);
    ok(cAfter, `${kfType} persisted to disk`);
    strictEqual(cAfter.keyframe_list[0].values[0], value);
  });
}

// ---------------------------------------------------------------------------
// add-keyframe: insertion ordering + replace-at-same-time
// ---------------------------------------------------------------------------

test("cmdAddKeyframe: multiple keyframes are sorted by time_offset", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdAddKeyframe(draft, filePath, seg.id, "2s", "scale_x", "1.5", undefined, flagsQuiet);
  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "1.0", undefined, flagsQuiet);
  cmdAddKeyframe(draft, filePath, seg.id, "1s", "scale_x", "1.2", undefined, flagsQuiet);

  const container = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  strictEqual(container.keyframe_list.length, 3);
  deepStrictEqual(
    container.keyframe_list.map((k) => k.time_offset),
    [0, 1_000_000, 2_000_000],
  );
});

test("cmdAddKeyframe: same time_offset replaces the existing keyframe", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "1.0", undefined, flagsQuiet);
  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "2.0", undefined, flagsQuiet);

  const container = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  strictEqual(container.keyframe_list.length, 1);
  strictEqual(container.keyframe_list[0].values[0], 2.0);
});

test("cmdAddKeyframe: save=false leaves file mtime unchanged", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);
  const mtimeBefore = statSync(filePath).mtimeMs;

  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "1.5", undefined, flagsQuiet, false);

  const mtimeAfter = statSync(filePath).mtimeMs;
  strictEqual(mtimeAfter, mtimeBefore);
});

// ---------------------------------------------------------------------------
// add-keyframe: curve override produces different control points than linear
// ---------------------------------------------------------------------------

test("cmdAddKeyframe: linear curve sets all control points to {0,0}", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "1.0", "linear", flagsQuiet);

  const kf = seg.common_keyframes[0].keyframe_list[0];
  deepStrictEqual(kf.left_control, { x: 0, y: 0 });
  deepStrictEqual(kf.right_control, { x: 0, y: 0 });
});

test("cmdAddKeyframe: ease-out curve produces non-zero right_control with negative y", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "1.0", "ease-out", flagsQuiet);

  const kf = seg.common_keyframes[0].keyframe_list[0];
  ok(kf.right_control.x > 0, `right_control.x should be > 0 for ease-out, got ${kf.right_control.x}`);
  strictEqual(kf.right_control.y, -0.47);
});

test("cmdAddKeyframe: ease-in differs from ease-out (different handle profile)", (t) => {
  const { filePath: f1 } = tmpDraft(CLEAN_FIXTURE, t);
  const { filePath: f2 } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft: d1 } = loadDraft(f1);
  const { draft: d2 } = loadDraft(f2);
  const { seg: s1 } = firstVideoSegment(d1);
  const { seg: s2 } = firstVideoSegment(d2);

  cmdAddKeyframe(d1, f1, s1.id, "0", "scale_x", "1.0", "ease-in", flagsQuiet);
  cmdAddKeyframe(d2, f2, s2.id, "0", "scale_x", "1.0", "ease-out", flagsQuiet);

  const k1 = s1.common_keyframes[0].keyframe_list[0];
  const k2 = s2.common_keyframes[0].keyframe_list[0];
  notStrictEqual(k1.right_control.y, k2.right_control.y);
});

// ---------------------------------------------------------------------------
// cmdAddKeyframe ⇄ cmdKenBurns parity (oracle of the v1.3.0 fix)
// ---------------------------------------------------------------------------

test("parity: cmdKenBurns ≡ 2× cmdAddKeyframe (ease-out, dv=+0.5, scale_x)", (t) => {
  // Build A: cmdKenBurns
  const { filePath: fA } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft: dA } = loadDraft(fA);
  const { seg: sA } = firstVideoSegment(dA);
  cmdKenBurns(dA, fA, sA.id, "1.0", "1.5", "ease-out", flagsQuiet);
  const dur = sA.target_timerange.duration;

  // Build B: two cmdAddKeyframe calls on scale_x
  const { filePath: fB } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft: dB } = loadDraft(fB);
  const { seg: sB } = firstVideoSegment(dB);
  cmdAddKeyframe(dB, fB, sB.id, "0",                        "scale_x", "1.0", "ease-out", flagsQuiet);
  cmdAddKeyframe(dB, fB, sB.id, `${dur / 1_000_000}s`,     "scale_x", "1.5", "ease-out", flagsQuiet);

  // Extract scale_x kfs from both drafts
  const scaleXA = sA.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list;
  const scaleXB = sB.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list;

  strictEqual(scaleXB.length, scaleXA.length, "kf count must match");
  for (let i = 0; i < scaleXA.length; i++) {
    deepStrictEqual(scaleXB[i].left_control,  scaleXA[i].left_control,  `kf[${i}].left_control mismatch`);
    deepStrictEqual(scaleXB[i].right_control, scaleXA[i].right_control, `kf[${i}].right_control mismatch`);
    deepStrictEqual(scaleXB[i].values,        scaleXA[i].values,        `kf[${i}].values mismatch`);
    strictEqual(scaleXB[i].time_offset,       scaleXA[i].time_offset,   `kf[${i}].time_offset mismatch`);
  }
});

// ---------------------------------------------------------------------------
// add-keyframe: error paths
// ---------------------------------------------------------------------------

test("add-keyframe: missing segment exits 1", () => {
  const r = runCli([
    "add-keyframe",
    fixturePath(CLEAN_FIXTURE),
    "nonexistent-id",
    "0",
    "--property",
    "scale_x",
    "--value",
    "1.5",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /Segment not found/);
});

test("add-keyframe: invalid property exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli([
    "add-keyframe",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "0",
    "--property",
    "garbage_property",
    "--value",
    "1.0",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /Invalid property/);
});

test("add-keyframe: missing --property exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli(["add-keyframe", fixturePath(CLEAN_FIXTURE), seg.id, "0", "--value", "1.0"]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /--property is required/);
});

test("add-keyframe: missing --value exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli(["add-keyframe", fixturePath(CLEAN_FIXTURE), seg.id, "0", "--property", "scale_x"]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /--value is required/);
});

test("add-keyframe: alpha out-of-range exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli([
    "add-keyframe",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "0",
    "--property",
    "alpha",
    "--value",
    "1.5",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /alpha must be 0\.0-1\.0/);
});

test("add-keyframe: time exceeds segment duration exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  // ANIMATIONS video segment is 5s long; ask for 999s
  const r = runCli([
    "add-keyframe",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "999s",
    "--property",
    "scale_x",
    "--value",
    "1.0",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /exceeds segment duration/);
});

test("add-keyframe: invalid curve exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli([
    "add-keyframe",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "0",
    "--property",
    "scale_x",
    "--value",
    "1.0",
    "--curve",
    "bouncy",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /Invalid curve/);
});

// ---------------------------------------------------------------------------
// ken-burns: happy path + parity vs fixture
// ---------------------------------------------------------------------------

test("cmdKenBurns: creates paired KFTypeScaleX + KFTypeScaleY containers", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdKenBurns(draft, filePath, seg.id, "1.0", "1.5", undefined, flagsQuiet);

  const cks = seg.common_keyframes;
  const scaleX = cks.find((c) => c.property_type === "KFTypeScaleX");
  const scaleY = cks.find((c) => c.property_type === "KFTypeScaleY");
  ok(scaleX, "scale_x container present");
  ok(scaleY, "scale_y container present");
  strictEqual(scaleX.keyframe_list.length, 2);
  strictEqual(scaleY.keyframe_list.length, 2);

  // Start kf at t=0 with values=[1.0], end kf at t=duration with values=[1.5]
  const segDur = seg.target_timerange.duration;
  strictEqual(scaleX.keyframe_list[0].time_offset, 0);
  strictEqual(scaleX.keyframe_list[1].time_offset, segDur);
  deepStrictEqual(scaleX.keyframe_list[0].values, [1.0]);
  deepStrictEqual(scaleX.keyframe_list[1].values, [1.5]);

  // X and Y kept in lock-step (Ken Burns pattern)
  deepStrictEqual(
    scaleX.keyframe_list.map((k) => k.values),
    scaleY.keyframe_list.map((k) => k.values),
  );
  deepStrictEqual(
    scaleX.keyframe_list.map((k) => k.time_offset),
    scaleY.keyframe_list.map((k) => k.time_offset),
  );
});

test("cmdKenBurns: ease-out (default) right_control matches Cubic Out profile (0.32 / -0.4)", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdKenBurns(draft, filePath, seg.id, "1.5", "1.0", undefined, flagsQuiet);

  const scaleX = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  const start = scaleX.keyframe_list[0];
  const end = scaleX.keyframe_list[1];
  const dur = seg.target_timerange.duration;

  // Canonical "Cubic Out" handle profile derived from ken-burns-draft.json.
  strictEqual(start.right_control.x, Math.round(0.32 * dur));
  strictEqual(start.right_control.y, -0.47);
  strictEqual(end.left_control.x, Math.round(-0.4 * dur));
  strictEqual(end.left_control.y, 0);
  deepStrictEqual(end.right_control, { x: 0, y: 0 });
  deepStrictEqual(start.left_control, { x: 0, y: 0 });
});

test("cmdKenBurns: ken-burns-draft fixture round-trip parity (handle ratios)", () => {
  // Tolerance contract:
  //   - Our impl places keyframes at t=0 and t=segment.duration. The shipped
  //     fixture places them at t=0 and t=<duration - tail-padding> (CapCut's
  //     UI leaves a small tail before segment-end). We therefore verify the
  //     handle ratio against the *keyframe interval*, not segment duration.
  //   - Tolerance on x ratio: ±0.001 (the canonical Cubic Out preset uses
  //     0.32 / -0.4 within rounding).
  //   - y values: exact (-0.47 on start.right, 0 on end.left).
  //   - UUIDs and graphID references are intentionally NOT compared — they
  //     are freshly generated per invocation by design.
  const fixture = loadFixture(FIXTURES.KEN_BURNS);
  const samples = [];
  for (const t of fixture.tracks) {
    for (const s of t.segments) {
      if ((s.common_keyframes ?? []).length === 2 && s.common_keyframes[0].property_type === "KFTypeScaleX") {
        samples.push(s);
      }
    }
  }
  ok(samples.length >= 1, "fixture contains at least one Ken Burns segment");

  for (const seg of samples) {
    const kfs = seg.common_keyframes[0].keyframe_list;
    const interval = kfs[1].time_offset - kfs[0].time_offset;
    const startRight = kfs[0].right_control;
    const endLeft = kfs[1].left_control;

    const startRatio = startRight.x / interval;
    const endRatio = endLeft.x / interval;

    ok(
      Math.abs(startRatio - 0.32) < 0.001,
      `seg ${seg.id}: start.right_control.x/interval = ${startRatio}, expected ≈ 0.32`,
    );
    ok(
      Math.abs(endRatio - -0.4) < 0.001,
      `seg ${seg.id}: end.left_control.x/interval = ${endRatio}, expected ≈ -0.4`,
    );
    strictEqual(startRight.y, -0.47);
    strictEqual(endLeft.y, 0);
  }
});

test("cmdKenBurns: overrides existing scale_x/scale_y containers (opinionated)", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  // Seed an unrelated scale_x keyframe first.
  cmdAddKeyframe(draft, filePath, seg.id, "0", "scale_x", "0.5", undefined, flagsQuiet);
  cmdAddKeyframe(draft, filePath, seg.id, "1s", "scale_x", "0.5", undefined, flagsQuiet);
  let scaleX = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  strictEqual(scaleX.keyframe_list.length, 2);
  strictEqual(scaleX.keyframe_list[0].values[0], 0.5);

  // ken-burns wipes and replaces.
  cmdKenBurns(draft, filePath, seg.id, "1.0", "1.5", undefined, flagsQuiet);
  scaleX = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  strictEqual(scaleX.keyframe_list.length, 2);
  deepStrictEqual(scaleX.keyframe_list[0].values, [1.0]);
  deepStrictEqual(scaleX.keyframe_list[1].values, [1.5]);
});

test("cmdKenBurns: curve override changes control points", (t) => {
  const { filePath: f1 } = tmpDraft(CLEAN_FIXTURE, t);
  const { filePath: f2 } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft: d1 } = loadDraft(f1);
  const { draft: d2 } = loadDraft(f2);
  const { seg: s1 } = firstVideoSegment(d1);
  const { seg: s2 } = firstVideoSegment(d2);

  cmdKenBurns(d1, f1, s1.id, "1.0", "1.5", "linear", flagsQuiet);
  cmdKenBurns(d2, f2, s2.id, "1.0", "1.5", "ease-out", flagsQuiet);

  const linearStart = s1.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list[0];
  const easeStart = s2.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list[0];

  deepStrictEqual(linearStart.right_control, { x: 0, y: 0 });
  notStrictEqual(easeStart.right_control.x, 0);
  strictEqual(easeStart.right_control.y, 0.47);
});

test("cmdKenBurns: ease-out start.right_control.y = round(0.94 × Δ) — zoom-in 1.0→1.12", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdKenBurns(draft, filePath, seg.id, "1.0", "1.12", "ease-out", flagsQuiet);

  const scaleX = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX");
  const start = scaleX.keyframe_list[0];
  const end = scaleX.keyframe_list[1];
  const dur = seg.target_timerange.duration;

  // Δ = 1.12 − 1.0 = 0.12 ; round(0.94 × 0.12, 6) = 0.1128 (NOT the legacy fixed -0.47)
  strictEqual(start.right_control.y, 0.1128);
  strictEqual(start.right_control.x, Math.round(0.32 * dur));
  deepStrictEqual(start.left_control, { x: 0, y: 0 });
  strictEqual(end.left_control.y, 0);
  deepStrictEqual(end.right_control, { x: 0, y: 0 });
});

test("cmdKenBurns: ease-out Δ=-0.5 preserves canonical Cubic Out y = -0.47 (parity lock)", (t) => {
  const { filePath } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft } = loadDraft(filePath);
  const { seg } = firstVideoSegment(draft);

  cmdKenBurns(draft, filePath, seg.id, "1.5", "1.0", "ease-out", flagsQuiet);

  const start = seg.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list[0];
  // round(0.94 × (1.0 − 1.5), 6) = round(0.94 × -0.5, 6) = -0.47 : the proven ground-truth value.
  strictEqual(start.right_control.y, -0.47);
});

test("cmdKenBurns: ease-out start.right_control.y is sign-symmetric in Δ", (t) => {
  const { filePath: fIn } = tmpDraft(CLEAN_FIXTURE, t);
  const { filePath: fOut } = tmpDraft(CLEAN_FIXTURE, t);
  const { draft: dIn } = loadDraft(fIn);
  const { draft: dOut } = loadDraft(fOut);
  const { seg: segIn } = firstVideoSegment(dIn);
  const { seg: segOut } = firstVideoSegment(dOut);

  cmdKenBurns(dIn, fIn, segIn.id, "1.0", "1.5", "ease-out", flagsQuiet); // Δ = +0.5
  cmdKenBurns(dOut, fOut, segOut.id, "1.5", "1.0", "ease-out", flagsQuiet); // Δ = -0.5

  const yIn = segIn.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list[0].right_control.y;
  const yOut = segOut.common_keyframes.find((c) => c.property_type === "KFTypeScaleX").keyframe_list[0].right_control.y;

  strictEqual(yIn, 0.47);
  strictEqual(yOut, -0.47);
  strictEqual(yIn, -yOut);
});

// ---------------------------------------------------------------------------
// ken-burns: error paths
// ---------------------------------------------------------------------------

test("ken-burns: missing --from exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli(["ken-burns", fixturePath(CLEAN_FIXTURE), seg.id, "--to", "1.5"]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /--from is required/);
});

test("ken-burns: missing --to exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli(["ken-burns", fixturePath(CLEAN_FIXTURE), seg.id, "--from", "1.0"]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /--to is required/);
});

test("ken-burns: from == to exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli([
    "ken-burns",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "--from",
    "1.0",
    "--to",
    "1.0",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /must differ/);
});

test("ken-burns: negative --from exits 1", () => {
  const { draft } = loadDraft(fixturePath(CLEAN_FIXTURE));
  const { seg } = firstVideoSegment(draft);
  const r = runCli([
    "ken-burns",
    fixturePath(CLEAN_FIXTURE),
    seg.id,
    "--from",
    "-1",
    "--to",
    "1.5",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /--from must be a positive number/);
});

test("ken-burns: audio segment (no clip) exits 1", () => {
  const { draft } = loadDraft(fixturePath(FIXTURES.KEN_BURNS));
  let audioSeg;
  for (const t of draft.tracks) {
    if (t.type === "audio") {
      audioSeg = t.segments[0];
      break;
    }
  }
  ok(audioSeg, "fixture has an audio segment");
  const r = runCli([
    "ken-burns",
    fixturePath(FIXTURES.KEN_BURNS),
    audioSeg.id,
    "--from",
    "1.0",
    "--to",
    "1.5",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /no clip/);
});

test("ken-burns: missing segment exits 1", () => {
  const r = runCli([
    "ken-burns",
    fixturePath(CLEAN_FIXTURE),
    "nonexistent-id",
    "--from",
    "1.0",
    "--to",
    "1.5",
  ]);
  strictEqual(r.status, 1);
  match(r.errorJson.error, /Segment not found/);
});

// ---------------------------------------------------------------------------
// VALID_CURVES export sanity
// ---------------------------------------------------------------------------

test("VALID_CURVES contains the documented four curves", () => {
  deepStrictEqual([...VALID_CURVES].sort(), ["ease-in", "ease-in-out", "ease-out", "linear"]);
});

test("PROPERTY_MAP covers the six documented KFType properties", () => {
  deepStrictEqual(Object.keys(PROPERTY_MAP).sort(), [
    "alpha",
    "position_x",
    "position_y",
    "rotation",
    "scale_x",
    "scale_y",
  ]);
});
