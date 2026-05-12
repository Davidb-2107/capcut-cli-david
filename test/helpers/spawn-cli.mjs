// Test helper: spawn the built capcut-david binary with the given args.
// Returns { status, stdout, stderr, json }.
//
// Used for error-path tests (the orchestrator-level surface where exit code
// matters) and happy-path tests where the test wants to assert on the
// CLI's JSON output verbatim.
//
// The CLI catches CliError and writes `{"error": "..."}` to stderr with
// exit code 1. Successful commands print JSON to stdout with exit code 0.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BIN = resolve(__dirname, "..", "..", "dist", "index.js");

export function runCli(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    input: opts.input,
    env: { ...process.env, ...(opts.env ?? {}) },
    cwd: opts.cwd,
  });
  let json;
  if (r.stdout) {
    const first = r.stdout.trim().split("\n")[0];
    if (first && (first.startsWith("{") || first.startsWith("["))) {
      try {
        json = JSON.parse(first);
      } catch {
        json = undefined;
      }
    }
  }
  let errorJson;
  if (r.stderr) {
    for (const line of r.stderr.trim().split("\n")) {
      if (line.startsWith("{")) {
        try {
          errorJson = JSON.parse(line);
          break;
        } catch {
          // ignore
        }
      }
    }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, errorJson };
}
