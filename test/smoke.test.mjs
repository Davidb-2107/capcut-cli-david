// Phase A smoke test. Verifies the built binary loads and parses the basics.
// Phase B replaces this with full fixture-backed coverage per the master plan.
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, "..", "dist", "index.js");

import { parseTimeInput, srtTime, formatDuration } from "../dist/utils/time.js";

test("parseTimeInput: '1.5s' → 1_500_000 us", () => {
  strictEqual(parseTimeInput("1.5s"), 1_500_000);
});

test("parseTimeInput: '500ms' → 500_000 us", () => {
  strictEqual(parseTimeInput("500ms"), 500_000);
});

test("parseTimeInput: '+1s' → 1_000_000 us; '-1s' → -1_000_000 us", () => {
  strictEqual(parseTimeInput("+1s"), 1_000_000);
  strictEqual(parseTimeInput("-1s"), -1_000_000);
});

test("parseTimeInput: '1:30' → 90 seconds", () => {
  strictEqual(parseTimeInput("1:30"), 90 * 1_000_000);
});

test("srtTime: 1_500_000 us → '00:00:01,500'", () => {
  strictEqual(srtTime(1_500_000), "00:00:01,500");
});

test("formatDuration: human-readable seconds", () => {
  strictEqual(formatDuration(500_000), "500ms");
  strictEqual(formatDuration(2_500_000), "2.50s");
});

test("binary --help prints usage", () => {
  const r = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf-8" });
  strictEqual(r.status, 0);
  strictEqual(r.stderr, "");
  ok(r.stdout.includes("capcut-david"));
  ok(r.stdout.includes("Usage:"));
  ok(r.stdout.endsWith("IDs: first 6+ chars of segment/material ID (prefix match)\n"));
  const short = spawnSync(process.execPath, [BIN, "-h"], { encoding: "utf-8" });
  strictEqual(short.status, 0);
  strictEqual(short.stderr, "");
  strictEqual(short.stdout, r.stdout);
});

test("help is only recognized as the first raw argument", () => {
  const noArgs = spawnSync(process.execPath, [BIN], { encoding: "utf-8" });
  strictEqual(noArgs.status, 0);
  strictEqual(noArgs.stderr, "");
  strictEqual(noArgs.stdout, spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf-8" }).stdout);

  const fixture = resolve(__dirname, "..", "test-fixtures", "fixtures", "minimal-draft.json");
  for (const [args, error] of [
    [["-q", "--help"], "Missing project path"],
    [["-H", "-h"], "Missing project path"],
    [["--out", "x", "--help"], "Missing project path"],
    [[""], "Missing project path"],
    [["", fixture], "Unknown command: ."],
  ]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8" });
    strictEqual(r.status, 1, `argv=${JSON.stringify(args)}`);
    strictEqual(r.stdout, "", `argv=${JSON.stringify(args)}`);
    ok(r.stderr.includes(error), `argv=${JSON.stringify(args)}: ${r.stderr}`);
  }
});

test("binary info on minimal fixture returns JSON with id+duration", () => {
  const fixture = resolve(__dirname, "..", "test-fixtures", "fixtures", "minimal-draft.json");
  const r = spawnSync(process.execPath, [BIN, "info", fixture], { encoding: "utf-8" });
  strictEqual(r.status, 0);
  strictEqual(r.stderr, "");
  const data = JSON.parse(r.stdout);
  ok(typeof data.id === "string");
  ok(typeof data.duration_us === "number");
});

test("binary unknown command exits 1 with error JSON", () => {
  const fixture = resolve(__dirname, "..", "test-fixtures", "fixtures", "minimal-draft.json");
  const r = spawnSync(process.execPath, [BIN, "bogus", fixture], { encoding: "utf-8" });
  strictEqual(r.status, 1);
  strictEqual(r.stdout, "");
  strictEqual(r.stderr, '{"error":"Unknown command: bogus. Run \'capcut-david --help\' for usage."}\n');
});

test("parser errors exit 1 with JSON on stderr before dispatch", () => {
  const fixture = resolve(__dirname, "..", "test-fixtures", "fixtures", "minimal-draft.json");
  for (const [args, error] of [
    [["info", fixture, "--kind=font"], '--kind takes a space-separated value (use --kind <k>), got "--kind=font"'],
    [["info", fixture, "--transform-y", "NaN"], '--transform-y must be a finite number, got "NaN"'],
  ]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8" });
    strictEqual(r.status, 1);
    strictEqual(r.stdout, "");
    strictEqual(r.stderr, `${JSON.stringify({ error })}\n`);
  }
});
