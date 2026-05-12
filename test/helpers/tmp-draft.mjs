// Test helper: deep-clone a fixture into a unique tmp directory and return the
// path to draft_content.json inside it. Tests use this when they need a
// mutable on-disk draft (e.g. set-text writes via saveDraft).
//
// Each invocation returns an isolated directory. Registers a node:test
// `before/after` style cleanup via the optional `t.after(...)` hook the
// caller passes in — pass the test context (`t`) and we auto-clean.
//
// Usage:
//   import { test } from "node:test";
//   import { tmpDraft } from "./helpers/tmp-draft.mjs";
//
//   test("foo", (t) => {
//     const { filePath, dir } = tmpDraft("minimal-draft", t);
//     // ... use filePath ...
//   });

import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fixturePath } from "./load-fixture.mjs";

const PREFIX = "capcut-cli-david-test-";

export function tmpDraft(fixtureKey, t) {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  const filePath = resolve(dir, "draft_content.json");
  copyFileSync(fixturePath(fixtureKey), filePath);

  if (t && typeof t.after === "function") {
    t.after(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // tmp cleanup is best-effort.
      }
    });
  }

  return { filePath, dir };
}

// Cleanup helper for tests that don't have a test context (subtest helpers).
export function cleanupTmp(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
