// LocalDraftStore.load must tolerate a UTF-8 BOM: external Windows tools (e.g. PowerShell
// Set-Content -Encoding UTF8) write draft_content.json with a BOM, and bare
// JSON.parse throws on U+FEFF. The CLI itself never writes a BOM.
import { test } from "node:test";
import { strictEqual } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalDraftStore } from "../dist/draft.js";

test("LocalDraftStore.load: parses a draft_content.json written with a UTF-8 BOM", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-bom-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  const file = join(dir, "draft_content.json");
  const BOM = String.fromCharCode(0xfeff);
  writeFileSync(file, BOM + JSON.stringify({ id: "bom-test", tracks: [] }), "utf-8");
  const { draft } = new LocalDraftStore().load(dir);
  strictEqual(draft.id, "bom-test");
});
