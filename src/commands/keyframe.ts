import { type Draft, findSegment, type Segment, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { uuid } from "../utils/companion.js";
import { parseTimeInput } from "../utils/time.js";

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
// interval between adjacent keyframes (in microseconds); y is the easing
// factor (dimensionless). The `ease-out` profile is derived empirically from
// the "Cubic Out" preset embedded in test-fixtures/fixtures/ken-burns-draft.json:
//   - start.right_control.x / interval =  234667 / 733333 ≈ +0.32
//   - end.left_control.x   / interval = -293333 / 733333 ≈ -0.4
//   - start.right_control.y = -0.47 ; end.left_control.y = 0
// Other curves use CSS cubic-bezier(P1.x, P1.y, P2.x, P2.y) interior handles
// remapped from a normalized [0,1] interval onto absolute microseconds.
interface CurveProfile {
  startRightXRatio: number;
  startRightY: number;
  endLeftXRatio: number;
  endLeftY: number;
}

const CURVE_PROFILES: Record<CurveName, CurveProfile> = {
  linear: { startRightXRatio: 0, startRightY: 0, endLeftXRatio: 0, endLeftY: 0 },
  "ease-in": { startRightXRatio: 0.42, startRightY: 0, endLeftXRatio: 0, endLeftY: 0 },
  "ease-out": { startRightXRatio: 0.32, startRightY: -0.47, endLeftXRatio: -0.4, endLeftY: 0 },
  "ease-in-out": { startRightXRatio: 0.42, startRightY: 0, endLeftXRatio: -0.42, endLeftY: 0 },
};

export const KEN_BURNS_DEFAULT_CURVE: CurveName = "ease-out";

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

function computeControlPoints(
  curve: CurveName,
  timeOffset: number,
  segDuration: number,
  kfList: Keyframe[],
): { left: ControlPoint; right: ControlPoint } {
  if (curve === "linear") {
    return { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  }
  const profile = CURVE_PROFILES[curve];
  const prev = kfList.filter((k) => k.time_offset < timeOffset).sort((a, b) => b.time_offset - a.time_offset)[0];
  const next = kfList.filter((k) => k.time_offset > timeOffset).sort((a, b) => a.time_offset - b.time_offset)[0];
  const intervalLeft = prev ? timeOffset - prev.time_offset : Math.max(1, timeOffset);
  const intervalRight = next ? next.time_offset - timeOffset : Math.max(1, segDuration - timeOffset);
  return {
    left: { x: Math.round(profile.endLeftXRatio * intervalLeft), y: profile.endLeftY },
    right: { x: Math.round(profile.startRightXRatio * intervalRight), y: profile.startRightY },
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
  const { left, right } = computeControlPoints(curve, timeOffset, segDuration, kfList);
  const kf = makeKeyframe(timeOffset, value, left, right);

  const existingIdx = kfList.findIndex((k) => k.time_offset === timeOffset);
  if (existingIdx >= 0) {
    kfList[existingIdx] = kf;
  } else {
    kfList.push(kf);
    kfList.sort((a, b) => a.time_offset - b.time_offset);
  }

  if (save) saveDraft(filePath, draft);
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
  const startRight: ControlPoint = {
    x: Math.round(profile.startRightXRatio * duration),
    y: profile.startRightY,
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
