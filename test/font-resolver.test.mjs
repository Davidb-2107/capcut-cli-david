import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveFontReference } from "../dist/utils/font-resolver.js";

function sandbox(t) {
  const root = join(tmpdir(), `capcut-font-resolver-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "Shared"), { recursive: true });
  mkdirSync(join(root, "Projects"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function catalogueEntry({ id, names, resource_id = id, font_paths = [] }) {
  return {
    id,
    kinds: ["font"],
    names,
    resource_id,
    effect_id: null,
    font_paths,
    first_seen: "2026-08-29",
    witness_drafts: ["deleted-witness"],
    note: "",
    ignored: false,
    merged_from: [],
    classification: "",
  };
}

function writeCatalogue(root, entries) {
  writeFileSync(join(root, "Shared", "capcut-catalogue.json"), JSON.stringify({ type: "capcut-david/catalogue@1", entries }));
}

function writeDraft(root, name, title, path, resourceId = "") {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "draft_content.json"), JSON.stringify({
    materials: {
      texts: [{
        font_path: path,
        font_resource_id: resourceId,
        fonts: [{ title, path, resource_id: resourceId, source_platform: resourceId ? 1 : 0 }],
      }],
    },
  }));
}

test("catalogue path wins and survives a deleted witness draft", (t) => {
  const root = sandbox(t);
  const fontPath = join(root, "fonts", "Metro.ttf");
  mkdirSync(join(root, "fonts"), { recursive: true });
  writeFileSync(fontPath, "font fixture");
  writeCatalogue(root, [catalogueEntry({ id: "123", names: ["Metro Sans"], font_paths: [fontPath] })]);

  deepStrictEqual(resolveFontReference("metro", { cwd: root, draftsRoot: join(root, "missing-drafts") }), {
    title: "Metro Sans",
    resourceId: "123",
    fontPath,
    source: "catalogue",
  });
});

test("catalogue resource IDs match exactly", (t) => {
  const root = sandbox(t);
  const first = join(root, "first.ttf");
  const second = join(root, "second.ttf");
  writeFileSync(first, "fixture");
  writeFileSync(second, "fixture");
  writeCatalogue(root, [
    catalogueEntry({ id: "123", names: ["First"], font_paths: [first] }),
    catalogueEntry({ id: "1234", names: ["Second"], font_paths: [second] }),
  ]);

  strictEqual(resolveFontReference("123", { cwd: root }).title, "First");
});

test("falls back to a readable current draft when catalogue has no match", (t) => {
  const root = sandbox(t);
  const fontPath = join(root, "draft-font.ttf");
  writeFileSync(fontPath, "font fixture");
  writeCatalogue(root, []);
  writeDraft(root, "draft-a", "Draft Font", fontPath, "987");

  deepStrictEqual(resolveFontReference("draft font", { cwd: root, draftsRoot: root }), {
    title: "Draft Font",
    resourceId: "987",
    fontPath,
    source: "draft",
  });
});

test("matching catalogue paths are all checked before reporting a dead path", (t) => {
  const root = sandbox(t);
  const existing = join(root, "fonts", "actual.ttf");
  mkdirSync(join(root, "fonts"), { recursive: true });
  writeFileSync(existing, "font fixture");
  writeCatalogue(root, [catalogueEntry({ id: "55", names: ["Recovered"], font_paths: [join(root, "gone.ttf"), existing] })]);

  strictEqual(resolveFontReference("recovered", { cwd: root }).fontPath, existing);
});

test("a matching catalogue entry with no readable path does not fall through to drafts", (t) => {
  const root = sandbox(t);
  const draftPath = join(root, "draft-font.ttf");
  writeFileSync(draftPath, "font fixture");
  writeDraft(root, "draft-a", "Dead Font", draftPath, "55");
  writeCatalogue(root, [catalogueEntry({ id: "55", names: ["Dead Font"], font_paths: [join(root, "gone.ttf")] })]);

  throws(() => resolveFontReference("dead", { cwd: root, draftsRoot: root }), /catalogue.*readable/i);
});

test("ambiguous catalogue name includes candidate identities", (t) => {
  const root = sandbox(t);
  const first = join(root, "a.ttf");
  const second = join(root, "b.ttf");
  writeFileSync(first, "fixture");
  writeFileSync(second, "fixture");
  writeCatalogue(root, [
    catalogueEntry({ id: "1", names: ["Line Art"], font_paths: [first] }),
    catalogueEntry({ id: "2", names: ["Line Bold"], font_paths: [second] }),
  ]);

  throws(() => resolveFontReference("line", { cwd: root }), /Line Art.*1.*Line Bold.*2/);
});

test("local-only catalogue entries resolve with a null resource ID", (t) => {
  const root = sandbox(t);
  const fontPath = join(root, "local.ttf");
  writeFileSync(fontPath, "font fixture");
  writeCatalogue(root, [catalogueEntry({ id: `local:${fontPath.toLowerCase()}`, names: ["Local Font"], resource_id: null, font_paths: [fontPath] })]);

  const result = resolveFontReference("local font", { cwd: root });
  strictEqual(result.resourceId, null);
  strictEqual(result.source, "catalogue");
  ok(existsSync(result.fontPath));
});

