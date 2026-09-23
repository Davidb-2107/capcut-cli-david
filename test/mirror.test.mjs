// Tests for the font-mirroring sidecar pass (src/utils/mirror.ts → dist).
// Ports fix_content_styles_font.py (walk content.styles[].font) + fix_key_value.py
// (key_value registry) + restyle.py's template-2.tmp mirror. Skip-if-absent; the
// root draft_content.json.bak is deliberately NOT mirrored (it is the store's rollback,
// ticket 02). Never fabricates key_value.json.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildKeyValueEntry, mirrorFont } from "../dist/utils/mirror.js";

const FONT = { path: "C:/fonts/NEW.ttf", id: "NEWID", resourceId: "RID123" };
const KV_ENTRY = { materialId: "RID123", materialCategory: "font" };

function contentWithFont(path, id) {
  return JSON.stringify({ text: "hi", styles: [{ font: { path, id }, range: [0, 2] }] });
}

// A draft folder with the sidecars CapCut creates after first save.
function fakeDraftDir(withKeyValue = true) {
  const dir = mkdtempSync(join(tmpdir(), "restyle-mirror-"));
  writeFileSync(join(dir, "draft_content.json"), JSON.stringify({ marker: "top" }), "utf-8");
  const patch = join(dir, "Timelines", "UUID1", "attachment", "patch");
  mkdirSync(patch, { recursive: true });
  const mini = { materials: { texts: [{ content: contentWithFont("OLD.ttf", "OLDID") }] } };
  writeFileSync(join(patch, "mini_draft.json"), JSON.stringify(mini), "utf-8");
  if (withKeyValue) writeFileSync(join(dir, "key_value.json"), JSON.stringify({ existing: { a: 1 } }), "utf-8");
  return dir;
}

test("mirrorFont: forces content.styles[].font.path/.id inside Timelines mini_draft.json", () => {
  const dir = fakeDraftDir();
  mirrorFont(dir, { v: 1 }, FONT, KV_ENTRY);
  const mini = JSON.parse(readFileSync(join(dir, "Timelines", "UUID1", "attachment", "patch", "mini_draft.json"), "utf-8"));
  const font = JSON.parse(mini.materials.texts[0].content).styles[0].font;
  strictEqual(font.path, "C:/fonts/NEW.ttf");
  strictEqual(font.id, "NEWID");
});

test("mirrorFont: writes the new draft state to template-2.tmp, but NEVER the root draft_content.json.bak (ticket 02)", () => {
  const dir = fakeDraftDir();
  const res = mirrorFont(dir, { v: 2 }, FONT, KV_ENTRY);
  deepStrictEqual(JSON.parse(readFileSync(join(dir, "template-2.tmp"), "utf-8")), { v: 2 });
  // The root draft_content.json.bak is the draft store's rollback (persistDraft,
  // written with the PRE-edit bytes). The font mirror must never clobber it, or a
  // font restyle would silently destroy the user's undo of the root edit.
  strictEqual(existsSync(join(dir, "draft_content.json.bak")), false, "root rollback must not be created by the mirror");
  ok(!res.written.includes("draft_content.json.bak"), "root .bak must not be reported as mirrored");
});

test("mirrorFont: injects a key_value entry keyed by resourceId, keeping existing keys", () => {
  const dir = fakeDraftDir();
  mirrorFont(dir, {}, FONT, KV_ENTRY);
  const kv = JSON.parse(readFileSync(join(dir, "key_value.json"), "utf-8"));
  deepStrictEqual(kv.RID123, KV_ENTRY, "entry injected under resourceId");
  ok(kv.existing, "pre-existing registry keys preserved");
});

test("mirrorFont: never fabricates key_value.json when absent (skip-if-absent)", () => {
  const dir = fakeDraftDir(false);
  mirrorFont(dir, {}, FONT, KV_ENTRY);
  strictEqual(existsSync(join(dir, "key_value.json")), false, "must not create key_value.json from scratch");
});

test("buildKeyValueEntry: reproduces the CapCut font registry entry (key fields)", () => {
  const e = buildKeyValueEntry("7457793217560318481", "Presets", "cc-derst");
  strictEqual(e.materialId, "7457793217560318481");
  strictEqual(e.materialCategory, "font");
  strictEqual(e.materialSubcategory, "Presets");
  strictEqual(e.searchKeyword, "cc-derst");
  strictEqual(e.keywordSource, "normal_search");
});

test("mirrorFont: returns the list of sidecars it touched", () => {
  const dir = fakeDraftDir();
  const res = mirrorFont(dir, {}, FONT, KV_ENTRY);
  ok(res.written.includes("template-2.tmp"));
  ok(res.written.includes("key_value.json"));
  ok(res.written.some((w) => w.includes("mini_draft.json")));
});
