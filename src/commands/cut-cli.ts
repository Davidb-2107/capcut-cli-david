import { writeFileSync } from "node:fs";
import type { Draft } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { parseTimeInput } from "../utils/time.js";
import { type CutOptions, cutProject } from "./cut.js";

export function cmdCut(draft: Draft, _filePath: string, positional: string[], flags: Flags): void {
  if (!flags.out) die("Missing --out <path>. Usage: capcut-david cut <project> <start> <end> --out <path>");
  const start = parseTimeInput(positional[2]);
  const end = parseTimeInput(positional[3]);
  if (end <= start) die("End time must be after start time");
  const opts: CutOptions = { start, end };
  const result = cutProject(draft, opts);
  const indent = 0;
  writeFileSync(flags.out, JSON.stringify(draft, null, indent), "utf-8");
  out({ ok: true, kept: result.kept, removed: result.removed, duration_us: end - start, out: flags.out }, flags);
}
