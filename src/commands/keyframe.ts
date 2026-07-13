import { type Draft, findSegment, type Segment, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { uuid } from "../utils/companion.js";
import { parseTimeInput } from "../utils/time.js";
import { readBatchItems } from "./create.js";

export type CurveName = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export const VALID_CURVES: readonly CurveName[] = ["linear", "ease-in", "ease-out", "ease-in-out"];

// CLI property name → CapCut `property_type` identifier (KFType*).
export const PROPERTY_MAP: Record<string, string> = {
  scale_x: "KFTypeScaleX",
  scale_y: "KFTypeScaleY",
  position_x: "KFTypePositionX",
  position_y: "KFTypePositionY",
  rotation: "KFTypeRotation",
  alpha: "KFTypeAlpha",
};

// Bezier handle profile per curve. Handle x is expressed as a ratio of the
// interval between adjacent keyframes (in microseconds). Handle y for the
// "ease-out" curve is NOT a fixed absolute: CapCut's "Cubic Out" preset
// writes start.right_control.y = round(0.94 × Δvalue, 6), where
// Δ = rightKf.value − leftKf.value. The historical -0.47 was only the
// Δ = -0.5 case (0.94 × -0.5). end.left_control.y = 0 across all supported
// curves.
//
// Both code paths converge on this model via the shared helper
// computeSegmentHandles:
//   - cmdKenBurns (v1.2.0+) — pair-construction path
//   - cmdAddKeyframe (v1.3.0+) — incremental path with retro-update of
//     neighbor handles on insertion
//
// x ratios, empirically from test-fixtures/fixtures/ken-burns-draft.json:
//   - start.right_control.x / interval =  234667 / 733333 ≈ +0.32
//   - end.left_control.x   / interval = -293333 / 733333 ≈ -0.4
// Other curves use CSS cubic-bezier(P1.x, P1.y, P2.x, P2.y) interior handles
// remapped from a normalized [0,1] interval onto absolute microseconds.
//
// Byte-identity contract with CapCut UI (Cubic Out, scale_x):
//   - On frame-aligned intervals (multiples of 1/fps × 1e6 μs — e.g.
//     5_000_000 μs at 60fps), control.x values match CapCut byte-for-byte
//     because -0.4 × interval and +0.32 × interval are exact integers.
//   - On non-aligned intervals, CapCut's rounding is neither floor nor
//     round consistently across captures (see fixture notes below); v1.3.0
//     uses Math.round and may differ by ≤ 1 μs on control.x. This is below
//     1/16 of a frame at 60fps — imperceptible.
//   - control.y = round(0.94 × Δvalue, 6) on our side vs raw IEEE 754
//     product on CapCut's side. For "clean" Δvalue (±0.5 → ±0.47) the two
//     are bit-identical; for "ugly" Δvalue (±0.3 → ±0.282) they land on
//     adjacent IEEE 754 doubles (1 ULP, ~5e-17 apart).
// Captured oracle proving these bounds: test-fixtures/oracles/
// cubic-out-triplet-frame-aligned.json (3 kf, frame-aligned 5M μs +
// non-aligned 3.133M μs, both ease-out).
interface CurveProfile {
  startRightXRatio: number;
  startRightY: number;
  endLeftXRatio: number;
  endLeftY: number;
}

const CURVE_PROFILES: Record<CurveName, CurveProfile> = {
  linear: { startRightXRatio: 0, startRightY: 0, endLeftXRatio: 0, endLeftY: 0 },
  "ease-in": { startRightXRatio: 0.42, startRightY: 0, endLeftXRatio: 0, endLeftY: 0 },
  // ease-out: Δ-scaled y comes from KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO via
  // computeSegmentHandles (shared model with cmdKenBurns). startRightY=0
  // here is intentionally the no-op fallback — never consumed for ease-out.
  "ease-out": { startRightXRatio: 0.32, startRightY: 0, endLeftXRatio: -0.4, endLeftY: 0 },
  "ease-in-out": { startRightXRatio: 0.42, startRightY: 0, endLeftXRatio: -0.42, endLeftY: 0 },
};

export const KEN_BURNS_DEFAULT_CURVE: CurveName = "ease-out";

// CapCut "Cubic Out": the first keyframe of a pair encodes
//   start.right_control.y = ratio × Δvalue   (Δ = toVal − fromVal),
// NOT a fixed absolute. The historically hard-coded -0.47 was only the
// Δ = -0.5 special case (0.94 × -0.5). Proven by:
//   - CapCut-ZoomFX/Tools/tests/fixtures/cubic-out-groundtruth.json (real capture)
//   - cutcli-fix tools/cutcli-fix/curves.py (CUBIC_OUT_RIGHT_CONTROL_KF1_RATIOS.y)
//   - CapCut-ZoomFX/docs/superpowers/2026-05-19-cubic-out-parity-findings.md
export const KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO = 0.94;

interface ControlPoint {
  x: number;
  y: number;
}

interface Keyframe {
  id: string;
  curveType: string;
  time_offset: number;
  left_control: ControlPoint;
  right_control: ControlPoint;
  values: number[];
  string_value: string;
  graphID: string;
}

interface KFContainer {
  id: string;
  material_id: string;
  property_type: string;
  keyframe_list: Keyframe[];
}

function getCommonKeyframes(segment: Segment): KFContainer[] {
  if (!Array.isArray(segment.common_keyframes)) {
    segment.common_keyframes = [];
  }
  return segment.common_keyframes as KFContainer[];
}

function getOrCreateContainer(segment: Segment, propertyType: string): KFContainer {
  const cks = getCommonKeyframes(segment);
  let container = cks.find((c) => c.property_type === propertyType);
  if (!container) {
    container = { id: uuid().toUpperCase(), material_id: "", property_type: propertyType, keyframe_list: [] };
    cks.push(container);
  }
  return container;
}

function makeKeyframe(timeOffset: number, value: number, leftCtrl: ControlPoint, rightCtrl: ControlPoint): Keyframe {
  return {
    id: uuid().toUpperCase(),
    curveType: "FreeCurveInOut",
    time_offset: timeOffset,
    left_control: leftCtrl,
    right_control: rightCtrl,
    values: [value],
    string_value: "",
    graphID: "",
  };
}

// Compute the (right_control of left kf, left_control of right kf) pair for
// a segment between two keyframes. Unified Cubic Out model shared with
// cmdKenBurns: for ease-out, right.y = round(0.94 × Δvalue, 6); for other
// curves, right.y = profile.startRightY (0 for linear / ease-in /
// ease-in-out). x is always profile.{startRightXRatio,endLeftXRatio} × interval.
function computeSegmentHandles(
  curve: CurveName,
  leftKfValue: number,
  rightKfValue: number,
  interval: number,
): { leftKfRight: ControlPoint; rightKfLeft: ControlPoint } {
  if (curve === "linear") {
    return { leftKfRight: { x: 0, y: 0 }, rightKfLeft: { x: 0, y: 0 } };
  }
  const profile = CURVE_PROFILES[curve];
  const dv = rightKfValue - leftKfValue;
  const rightY =
    curve === "ease-out" ? Math.round(KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO * dv * 1e6) / 1e6 : profile.startRightY;
  return {
    leftKfRight: { x: Math.round(profile.startRightXRatio * interval), y: rightY },
    rightKfLeft: { x: Math.round(profile.endLeftXRatio * interval), y: profile.endLeftY },
  };
}

// Compute control points for a newly inserted/replaced keyframe, AND
// produce retro-update payloads for the two neighbors (prev.right and
// next.left) so the curve specified at insertion applies coherently to
// both adjacent segments (prev→new and new→next).
//
// Semantics: the curve of the inserted kf wins on its two adjacent
// segments — aligned with CapCut UI behavior. Δ-scaling for right.y is
// ease-out only (cf. KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO); other curves
// keep right.y = 0. x is always interval × ratio.
//
// Edge cases:
//   - no prev → newLeft = {0, 0}, no prevRetro.
//   - no next → newRight = {0, 0}, no nextRetro.
//   - solitary kf → left = right = {0, 0} (no segment to encode).
function computeKfHandlesAndRetroUpdates(
  curve: CurveName,
  timeOffset: number,
  value: number,
  kfList: Keyframe[],
): {
  newLeft: ControlPoint;
  newRight: ControlPoint;
  prevRetro: { kf: Keyframe; right: ControlPoint } | null;
  nextRetro: { kf: Keyframe; left: ControlPoint } | null;
} {
  const prev = kfList.filter((k) => k.time_offset < timeOffset).sort((a, b) => b.time_offset - a.time_offset)[0];
  const next = kfList.filter((k) => k.time_offset > timeOffset).sort((a, b) => a.time_offset - b.time_offset)[0];

  const leftSegment = prev ? computeSegmentHandles(curve, prev.values[0], value, timeOffset - prev.time_offset) : null;
  const rightSegment = next ? computeSegmentHandles(curve, value, next.values[0], next.time_offset - timeOffset) : null;

  const newLeft: ControlPoint = leftSegment ? leftSegment.rightKfLeft : { x: 0, y: 0 };
  const newRight: ControlPoint = rightSegment ? rightSegment.leftKfRight : { x: 0, y: 0 };

  return {
    newLeft,
    newRight,
    prevRetro: prev && leftSegment ? { kf: prev, right: leftSegment.leftKfRight } : null,
    nextRetro: next && rightSegment ? { kf: next, left: rightSegment.rightKfLeft } : null,
  };
}

function parseValue(property: string, valueStr: string): number {
  const v = parseFloat(valueStr);
  if (Number.isNaN(v)) die(`Invalid value: ${valueStr}`);
  if (property === "alpha" && (v < 0 || v > 1)) die("alpha must be 0.0-1.0");
  if ((property === "scale_x" || property === "scale_y") && v <= 0) die(`${property} must be > 0`);
  return v;
}

export function cmdAddKeyframe(
  draft: Draft,
  filePath: string,
  segId: string,
  timeStr: string,
  property: string | undefined,
  valueStr: string | undefined,
  curveStr: string | undefined,
  flags: Flags,
  save = true,
): void {
  if (!property) die("--property is required (scale_x|scale_y|position_x|position_y|rotation|alpha)");
  if (valueStr === undefined) die("--value is required");
  const kfType = PROPERTY_MAP[property];
  if (!kfType) {
    die(`Invalid property "${property}". Valid: ${Object.keys(PROPERTY_MAP).join(", ")}`);
  }

  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const seg = result.segment;

  const value = parseValue(property, valueStr);
  const timeOffset = parseTimeInput(timeStr);
  if (timeOffset < 0) die("Time offset must be >= 0");

  const segDuration = (seg.target_timerange?.duration ?? 0) as number;
  if (timeOffset > segDuration) {
    die(`Time offset ${timeOffset}μs exceeds segment duration ${segDuration}μs`);
  }

  let curve: CurveName = "linear";
  if (curveStr !== undefined) {
    if (!(VALID_CURVES as readonly string[]).includes(curveStr)) {
      die(`Invalid curve "${curveStr}". Valid: ${VALID_CURVES.join(", ")}`);
    }
    curve = curveStr as CurveName;
  }

  const container = getOrCreateContainer(seg, kfType);
  const kfList = container.keyframe_list;
  const { newLeft, newRight, prevRetro, nextRetro } = computeKfHandlesAndRetroUpdates(curve, timeOffset, value, kfList);
  // Apply retro-updates in-place on neighbor kfs (by reference through kfList).
  if (prevRetro) prevRetro.kf.right_control = prevRetro.right;
  if (nextRetro) nextRetro.kf.left_control = nextRetro.left;
  const kf = makeKeyframe(timeOffset, value, newLeft, newRight);

  const existingIdx = kfList.findIndex((k) => k.time_offset === timeOffset);
  if (existingIdx >= 0) {
    kfList[existingIdx] = kf;
  } else {
    kfList.push(kf);
    kfList.sort((a, b) => a.time_offset - b.time_offset);
  }

  if (save) {
    saveDraft(filePath, draft);
    out(
      {
        ok: true,
        id: seg.id,
        property: kfType,
        time_offset_us: timeOffset,
        value,
        curve,
        keyframes: kfList.length,
      },
      flags,
    );
  }
}

interface KeyframeBatchEntry {
  segment_id: string;
  property: string;
  keyframes: { time: number | string; value: number | string; curve?: string }[];
}

export function cmdAddKeyframeBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-keyframe") as unknown as KeyframeBatchEntry[];
  // all-or-nothing pass 1: structural validation + segment existence (cmdAddKeyframe
  // dies on bad property/curve/time BEFORE mutating, but only per call — so pre-check
  // the cheap structural facts here to fail before ANY mutation)
  raw.forEach((e, i) => {
    const label = `add-keyframe --batch entry ${i + 1}`;
    if (typeof e.segment_id !== "string" || !e.segment_id) die(`${label}: "segment_id" is required`);
    if (typeof e.property !== "string" || !e.property) die(`${label}: "property" is required`);
    if (!Array.isArray(e.keyframes) || e.keyframes.length === 0) die(`${label}: non-empty "keyframes" array required`);
    if (!findSegment(draft, e.segment_id)) die(`${label}: Segment not found: ${e.segment_id}`);
  });
  let count = 0;
  for (const e of raw) {
    for (const kf of e.keyframes) {
      // Numeric time = raw µs (matches add-video/add-audio batch convention);
      // string time is a time-expression ("2s", "500ms") fed to parseTimeInput
      // as-is. cmdAddKeyframe always parses its timeStr as seconds via
      // parseTimeInput, so a raw-µs number must be rescaled to seconds first.
      const timeStr = typeof kf.time === "number" ? String(kf.time / 1_000_000) : kf.time;
      cmdAddKeyframe(
        draft,
        filePath,
        e.segment_id,
        timeStr,
        e.property,
        String(kf.value),
        kf.curve,
        { ...flags, quiet: true },
        /* save */ false,
      );
      count++;
    }
  }
  saveDraft(filePath, draft); // ONE save
  out({ ok: true, count }, flags);
}

export function cmdKenBurns(
  draft: Draft,
  filePath: string,
  segId: string,
  fromStr: string | undefined,
  toStr: string | undefined,
  curveStr: string | undefined,
  flags: Flags,
  save = true,
): void {
  if (fromStr === undefined) die("--from is required (starting scale, e.g. 1.0)");
  if (toStr === undefined) die("--to is required (ending scale, e.g. 1.5)");

  const result = findSegment(draft, segId);
  if (!result) die(`Segment not found: ${segId}`);
  const seg = result.segment;
  if (!seg.clip) die(`Segment ${segId} has no clip (audio segment?)`);

  const fromVal = parseFloat(fromStr);
  const toVal = parseFloat(toStr);
  if (Number.isNaN(fromVal) || fromVal <= 0) die("--from must be a positive number (e.g. 1.0 or 1.5)");
  if (Number.isNaN(toVal) || toVal <= 0) die("--to must be a positive number");
  if (fromVal === toVal) die("--from and --to must differ (no zoom motion)");

  const duration = (seg.target_timerange?.duration ?? 0) as number;
  if (!duration || duration <= 0) die("Segment has no positive duration");

  let curve: CurveName = KEN_BURNS_DEFAULT_CURVE;
  if (curveStr !== undefined) {
    if (!(VALID_CURVES as readonly string[]).includes(curveStr)) {
      die(`Invalid curve "${curveStr}". Valid: ${VALID_CURVES.join(", ")}`);
    }
    curve = curveStr as CurveName;
  }

  const profile = CURVE_PROFILES[curve];
  const dv = toVal - fromVal; // validated above: finite, non-zero, fromVal/toVal > 0
  const startRight: ControlPoint = {
    x: Math.round(profile.startRightXRatio * duration),
    // CapCut "Cubic Out": y = ratio × Δvalue, NOT a fixed absolute (Δ=-0.5 → -0.47).
    y: curve === "ease-out" ? Math.round(KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO * dv * 1e6) / 1e6 : profile.startRightY,
  };
  const endLeft: ControlPoint = {
    x: Math.round(profile.endLeftXRatio * duration),
    y: profile.endLeftY,
  };
  const zero: ControlPoint = { x: 0, y: 0 };

  // Ken Burns is opinionated: wipe any existing scale_x / scale_y keyframe
  // containers before writing the new pair so the result is deterministic.
  const cks = getCommonKeyframes(seg);
  for (const propertyType of ["KFTypeScaleX", "KFTypeScaleY"] as const) {
    const idx = cks.findIndex((c) => c.property_type === propertyType);
    if (idx >= 0) cks.splice(idx, 1);
  }

  for (const propertyType of ["KFTypeScaleX", "KFTypeScaleY"] as const) {
    const container = getOrCreateContainer(seg, propertyType);
    container.keyframe_list.push(
      makeKeyframe(0, fromVal, { x: 0, y: 0 }, startRight),
      makeKeyframe(duration, toVal, endLeft, zero),
    );
  }

  if (save) saveDraft(filePath, draft);
  out(
    {
      ok: true,
      id: seg.id,
      from: fromVal,
      to: toVal,
      duration_us: duration,
      curve,
      keyframes_added: 4,
    },
    flags,
  );
}
