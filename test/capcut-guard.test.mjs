// Tests for engine-hardening #2 — "CapCut is open" preflight guard.
//
// CapCut keeps draft_content.json in memory and overwrites it on close. Writing
// via the CLI while CapCut is open → the edit is silently discarded. The guard
// refuses to write when CapCut is detected (block-by-default), with --force /
// CAPCUT_DAVID_FORCE as the escape hatch. It must NEVER throw in CI (CapCut not
// running, or tasklist/pgrep absent → fail-open).
//
// The detector takes an injectable "process lister" (DI) so the running/closed
// branches are testable without a real CapCut process or a real spawn.
import { test } from "node:test";
import { strictEqual, throws, doesNotThrow, ok } from "node:assert";

import { isCapCutRunning, assertCapCutClosed, WRITE_COMMANDS } from "../dist/utils/capcut-guard.js";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const FLAGS = { human: false, quiet: false };

// Injectable listers (stand in for tasklist / pgrep output).
const listerRunning = () => "Image Name                     PID\nCapCut.exe                    1234 Console";
const listerTasklistEmpty = () => "INFO: No tasks are running which match the specified criteria.";
const listerEmpty = () => "";
const listerUnknown = () => null; // command missing / spawn error → fail-open

// =============================================================
// isCapCutRunning (pure detection logic via DI)
// =============================================================

test("isCapCutRunning: true when the listing names CapCut", () => {
  strictEqual(isCapCutRunning(listerRunning), true);
});

test("isCapCutRunning: false when nothing matches", () => {
  strictEqual(isCapCutRunning(listerTasklistEmpty), false);
  strictEqual(isCapCutRunning(listerEmpty), false);
});

test("isCapCutRunning: false (fail-open) when the probe returns null", () => {
  strictEqual(isCapCutRunning(listerUnknown), false);
});

// =============================================================
// assertCapCutClosed (the guard)
// =============================================================

test("assertCapCutClosed: throws CliError when CapCut is running and no --force", () => {
  throws(() => assertCapCutClosed(FLAGS, listerRunning), /CapCut is running/i);
});

test("assertCapCutClosed: no throw when CapCut is not running", () => {
  doesNotThrow(() => assertCapCutClosed(FLAGS, listerTasklistEmpty));
});

test("assertCapCutClosed: no throw (fail-open) when the probe returns null", () => {
  doesNotThrow(() => assertCapCutClosed(FLAGS, listerUnknown));
});

test("assertCapCutClosed: --force bypasses even when CapCut is running", () => {
  doesNotThrow(() => assertCapCutClosed({ ...FLAGS, force: true }, listerRunning));
});

test("assertCapCutClosed: CAPCUT_DAVID_FORCE env bypasses even when CapCut is running", () => {
  const prev = process.env.CAPCUT_DAVID_FORCE;
  process.env.CAPCUT_DAVID_FORCE = "1";
  try {
    doesNotThrow(() => assertCapCutClosed(FLAGS, listerRunning));
  } finally {
    if (prev === undefined) delete process.env.CAPCUT_DAVID_FORCE;
    else process.env.CAPCUT_DAVID_FORCE = prev;
  }
});

// =============================================================
// WRITE_COMMANDS — every in-place draft writer must be guarded
// =============================================================

test("WRITE_COMMANDS: covers every command that writes a draft/index in place", () => {
  // These all call saveDraft() in place OR rewrite root_meta_info.json (register) —
  // i.e. every command vulnerable to CapCut's on-close overwrite.
  const mustGuard = [
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
    "gc",
  ];
  for (const c of mustGuard) {
    ok(WRITE_COMMANDS.has(c), `WRITE_COMMANDS must include "${c}"`);
  }
  // `init` creates a brand-new draft (no open-draft conflict) → must NOT be guarded.
  ok(!WRITE_COMMANDS.has("init"), "init must not be guarded");
});

// =============================================================
// CLI wiring (integration) — non-blocking paths are deterministic in CI
// =============================================================

test("add-text (CLI): --force flag is accepted and the write succeeds", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "1s", "hi", "--force"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, true);
  // --force must not leak into the caption text.
  strictEqual(r.json.text, "hi");
});

test("add-text (CLI): guard is wired but does not false-positive when CapCut is closed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  // Clear the helper's default bypass so the real detector runs (CI/dev: CapCut closed).
  const r = runCli(["add-text", filePath, "0", "1s", "hello"], { env: { CAPCUT_DAVID_FORCE: "" } });
  strictEqual(r.status, 0, `guard must not block when CapCut is closed; stderr: ${r.stderr}`);
  strictEqual(r.json?.ok, true);
});
