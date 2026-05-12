import { readFileSync } from "node:fs";
import { type Draft, saveDraft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { cmdOpacity, cmdSetText, cmdShift, cmdShiftAll, cmdSpeed, cmdTrim, cmdVolume } from "./edit.js";

interface BatchOp {
  cmd: string;
  id?: string;
  text?: string;
  offset?: string;
  speed?: number;
  volume?: number;
  opacity?: number;
  start?: string;
  duration?: string;
  track?: string;
}

function execBatchOp(draft: Draft, filePath: string, op: BatchOp, flags: Flags): void {
  const silent = { ...flags, quiet: true };
  switch (op.cmd) {
    case "set-text":
      if (!op.id || op.text === undefined) die("batch set-text requires id and text");
      cmdSetText(draft, filePath, op.id, op.text, silent, false);
      break;
    case "shift":
      if (!op.id || !op.offset) die("batch shift requires id and offset");
      cmdShift(draft, filePath, op.id, op.offset, silent, false);
      break;
    case "shift-all":
      if (!op.offset) die("batch shift-all requires offset");
      cmdShiftAll(draft, filePath, op.offset, { ...silent, track: op.track }, false);
      break;
    case "speed":
      if (!op.id || op.speed === undefined) die("batch speed requires id and speed");
      cmdSpeed(draft, filePath, op.id, String(op.speed), silent, false);
      break;
    case "volume":
      if (!op.id || op.volume === undefined) die("batch volume requires id and volume");
      cmdVolume(draft, filePath, op.id, String(op.volume), silent, false);
      break;
    case "opacity":
      if (!op.id || op.opacity === undefined) die("batch opacity requires id and opacity");
      cmdOpacity(draft, filePath, op.id, String(op.opacity), silent, false);
      break;
    case "trim":
      if (!op.id || !op.start || !op.duration) die("batch trim requires id, start, duration");
      cmdTrim(draft, filePath, op.id, op.start, op.duration, silent, false);
      break;
    default:
      die(`Unknown batch command: ${op.cmd}`);
  }
}

export function cmdBatch(draft: Draft, filePath: string, flags: Flags): void {
  // fd 0 = stdin, cross-platform (Windows lacks /dev/stdin path).
  const input = readFileSync(0, "utf-8").trim();
  if (!input) die("No input on stdin");
  const lines = input.split("\n");
  let ok = 0;
  let fail = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const op = JSON.parse(trimmed) as BatchOp;
      execBatchOp(draft, filePath, op, flags);
      ok++;
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`${JSON.stringify({ error: msg, line: trimmed })}\n`);
    }
  }
  saveDraft(filePath, draft);
  out({ ok: true, succeeded: ok, failed: fail }, flags);
}
