import { strictEqual, match, doesNotMatch } from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("package identity is detached from CapCut", () => {
  strictEqual(packageJson.name, "voice-calibration");
  strictEqual(packageJson.bin?.["voice-calibration"], "dist/calibration-cli.js");
  strictEqual(packageJson.bin?.["capcut-david"], undefined);
  doesNotMatch(packageJson.description, /CapCut|JianYing|psycho-build/i);
  doesNotMatch(readFileSync(resolve(root, "src/calibration/bridge.ts"), "utf8"), /capcut/i);
  match(readFileSync(resolve(root, "src/calibration/local-store.ts"), "utf8"), /\.voice-calibration/);
});

test("standalone CLI exposes only the calibration surface", () => {
  const result = spawnSync(process.execPath, [resolve(root, "dist/calibration-cli.js"), "--help"], {
    encoding: "utf8",
    cwd: root,
  });
  strictEqual(result.status, 0, result.stderr);
  match(result.stdout, /voice-calibration/);
  match(result.stdout, /--open/);
  doesNotMatch(result.stdout, /capcut-david|psycho-build/i);
});
