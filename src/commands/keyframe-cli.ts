import { type Draft, findSegment, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { parseTimeInput } from "../utils/time.js";
import { readBatchItems } from "./create-cli.js";
import {
  applyKenBurns,
  type CurveName,
  computeKfHandlesAndRetroUpdates,
  getOrCreateContainer,
  makeKeyframe,
  PROPERTY_MAP,
  parseValue,
  VALID_CURVES,
} from "./keyframe.js";

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

  const result = applyKenBurns(draft, {
    segmentId: segId,
    from: parseFloat(fromStr),
    to: parseFloat(toStr),
    curve: curveStr,
  });

  if (save) saveDraft(filePath, draft);
  out(
    {
      ok: true,
      id: result.segmentId,
      from: result.from,
      to: result.to,
      duration_us: result.durationUs,
      curve: result.curve,
      keyframes_added: result.keyframesAdded,
    },
    flags,
  );
}
