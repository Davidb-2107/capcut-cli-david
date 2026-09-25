import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const targets = ["dist/index.js", "dist/utils/cli.js", "dist/utils/capcut-guard.js"];
const dir = mkdtempSync(join(tmpdir(), "capcut-coverage-"));
const report = join(dir, "coverage.lcov");

try {
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-include=dist/commands/**/*.js",
      "--test-coverage-include=dist/draft.js",
      ...targets.map((path) => `--test-coverage-include=${path}`),
      "--test-coverage-lines=80",
      "--test-coverage-functions=80",
      "--test-reporter=spec",
      "--test-reporter=lcov",
      "--test-reporter-destination=stdout",
      `--test-reporter-destination=${report}`,
    ],
    { stdio: "inherit" },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) process.exitCode = run.status ?? 1;
  if (!existsSync(report)) throw new Error("Coverage report was not generated");

  const records = new Map(
    readFileSync(report, "utf8")
      .split("end_of_record")
      .filter((record) => /^SF:/m.test(record))
      .map((record) => [record.match(/^SF:(.*)$/m)[1].replaceAll("\\", "/"), record]),
  );
  for (const target of targets) {
    const record = records.get(target);
    if (!record) throw new Error(`Coverage target missing: ${target}`);
    for (const [label, hitKey, totalKey] of [
      ["lines", "LH", "LF"],
      ["functions", "FNH", "FNF"],
    ]) {
      const hit = Number(record.match(new RegExp(`^${hitKey}:(\\d+)$`, "m"))?.[1]);
      const total = Number(record.match(new RegExp(`^${totalKey}:(\\d+)$`, "m"))?.[1]);
      if (!total || hit / total < 0.8) {
        console.error(`Coverage below 80%: ${target} ${label} ${hit}/${total}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
