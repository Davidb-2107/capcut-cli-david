import { type Draft, findSegment, type Segment } from "../draft.js";
import { die } from "../utils/cli.js";
import { uuid } from "../utils/companion.js";

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

export function getOrCreateContainer(segment: Segment, propertyType: string): KFContainer {
  const cks = getCommonKeyframes(segment);
  let container = cks.find((c) => c.property_type === propertyType);
  if (!container) {
    container = { id: uuid().toUpperCase(), material_id: "", property_type: propertyType, keyframe_list: [] };
    cks.push(container);
  }
  return container;
}

export function makeKeyframe(timeOffset: number, value: number, leftCtrl: ControlPoint, rightCtrl: ControlPoint): Keyframe {
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
export function computeKfHandlesAndRetroUpdates(
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

export function parseValue(property: string, valueStr: string): number {
  const v = parseFloat(valueStr);
  if (Number.isNaN(v)) die(`Invalid value: ${valueStr}`);
  if (property === "alpha" && (v < 0 || v > 1)) die("alpha must be 0.0-1.0");
  if ((property === "scale_x" || property === "scale_y") && v <= 0) die(`${property} must be > 0`);
  return v;
}

export interface KenBurnsOptions {
  segmentId: string;
  from: number;
  to: number;
  /** Raw curve name, validated here — same string shape as the CLI --curve flag. */
  curve?: string;
}

export interface KenBurnsResult {
  segmentId: string;
  from: number;
  to: number;
  durationUs: number;
  curve: CurveName;
  keyframesAdded: number;
}

/**
 * Apply a Ken Burns zoom (paired scale_x/scale_y keyframes) to a segment.
 * Pure domain logic: no Flags, no save, no stdout — callers (cmdKenBurns,
 * pipeline.ts's psychoBuild) own persistence and output.
 */
export function applyKenBurns(draft: Draft, opts: KenBurnsOptions): KenBurnsResult {
  const { segmentId, from, to, curve: curveStr } = opts;

  const result = findSegment(draft, segmentId);
  if (!result) die(`Segment not found: ${segmentId}`);
  const seg = result.segment;
  if (!seg.clip) die(`Segment ${segmentId} has no clip (audio segment?)`);

  if (Number.isNaN(from) || from <= 0) die("--from must be a positive number (e.g. 1.0 or 1.5)");
  if (Number.isNaN(to) || to <= 0) die("--to must be a positive number");
  if (from === to) die("--from and --to must differ (no zoom motion)");

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
  const dv = to - from; // validated above: finite, non-zero, from/to > 0
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
      makeKeyframe(0, from, { x: 0, y: 0 }, startRight),
      makeKeyframe(duration, to, endLeft, zero),
    );
  }

  return { segmentId, from, to, durationUs: duration, curve, keyframesAdded: 4 };
}
