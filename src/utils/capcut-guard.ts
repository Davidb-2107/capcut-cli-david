import { spawnSync } from "node:child_process";
import { die, type Flags } from "./cli.js";

/**
 * Commands that write a draft (or CapCut's index) on disk. They run the
 * "CapCut is open" preflight so the CLI never silently loses edits to CapCut's
 * on-close overwrite. Covers every in-place `saveDraft` caller plus `register`
 * (rewrites root_meta_info.json — the file CapCut itself overwrites on close).
 * Read-only commands and `init` (creates a brand-new draft, no open-draft
 * conflict) are intentionally absent.
 */
export const WRITE_COMMANDS = new Set([
  "add-text",
  "add-audio",
  "add-video",
  "add-effect",
  "import-captions",
  "restyle",
  "set-text",
  "shift",
  "shift-all",
  "speed",
  "volume",
  "trim",
  "opacity",
  "add-keyframe",
  "ken-burns",
  "apply-template",
  "batch",
  "cut",
  "psycho-build",
  "register",
  "sync-timelines",
]);

/**
 * A "process lister": returns the raw process-listing text, or `null` when it
 * couldn't be obtained (command missing / spawn error). `null` is treated as
 * "unknown → not running" (fail-open) so CI — and any host without
 * tasklist/pgrep — never blocks. Injectable for testing.
 */
export type ProcessLister = () => string | null;

const defaultLister: ProcessLister = () => {
  try {
    const r =
      process.platform === "win32"
        ? spawnSync("tasklist", ["/FI", "IMAGENAME eq CapCut.exe"], { encoding: "utf-8" })
        : // macOS/Linux: -l lists the process name so the output is greppable, -i = case-insensitive.
          spawnSync("pgrep", ["-il", "capcut"], { encoding: "utf-8" });
    if (r.error) return null; // ENOENT (command absent) → fail-open
    return r.stdout ?? "";
  } catch {
    return null;
  }
};

/** True when the process listing names CapCut. Fail-open (false) on unknown. */
export function isCapCutRunning(lister: ProcessLister = defaultLister): boolean {
  const out = lister();
  if (out == null) return false;
  return /capcut/i.test(out);
}

/**
 * Refuse to write while CapCut is open. CapCut holds draft_content.json in
 * memory and rewrites it on close, silently discarding CLI edits. Bypass with
 * `--force` or the CAPCUT_DAVID_FORCE env var (used by automation/tests).
 */
export function assertCapCutClosed(flags: Flags, lister: ProcessLister = defaultLister): void {
  if (flags.force || process.env.CAPCUT_DAVID_FORCE) return;
  if (isCapCutRunning(lister)) {
    die(
      "CapCut is running — close it before writing (or pass --force). " +
        "CapCut overwrites the draft on close, silently discarding CLI edits.",
    );
  }
}
