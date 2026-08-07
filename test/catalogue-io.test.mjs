import { test } from "node:test";
import { strictEqual, throws, deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCatalogue, serializeCatalogue, writeCatalogueAtomic } from "../dist/commands/catalogue.js";

const entry = (over = {}) => ({
  id: "739",
  kinds: ["effect"],
  names: ["Vignette"],
  resource_id: "739",
  effect_id: null,
  font_paths: [],
  first_seen: "2026-01-01",
  witness_drafts: ["dA"],
  note: "",
  ignored: false,
  merged_from: [],
  ...over,
});

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cat-io-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return dir;
}

test("round-trip is byte-identical", () => {
  const text = serializeCatalogue([entry()]);
  deepStrictEqual(parseCatalogue(text), [entry()]);
  strictEqual(serializeCatalogue(parseCatalogue(text)), text);
});

test("output ends with exactly one newline", () => {
  const text = serializeCatalogue([entry()]);
  strictEqual(text.endsWith("}\n"), true);
  strictEqual(text.endsWith("\n\n"), false);
});

test("a BOM and CRLF on read do not change the parsed value", () => {
  const text = serializeCatalogue([entry()]);
  const hostile = `﻿${text.replace(/\n/g, "\r\n")}`;
  deepStrictEqual(parseCatalogue(hostile), parseCatalogue(text));
});

test("malformed JSON THROWS — it must never degrade to an empty catalogue", () => {
  throws(() => parseCatalogue("{ this is not json"), /catalogue/i);
});

test("valid JSON of the wrong shape also throws", () => {
  throws(() => parseCatalogue('{"type":"capcut-david/catalogue@1"}'), /catalogue/i);
  throws(() => parseCatalogue("[]"), /catalogue/i);
});

test("an empty catalogue is a legal round-trip", () => {
  deepStrictEqual(parseCatalogue(serializeCatalogue([])), []);
});

test("writeCatalogueAtomic writes the bytes and leaves no .tmp behind", (t) => {
  const dir = tmp(t);
  const p = join(dir, "capcut-catalogue.json");
  const text = serializeCatalogue([entry()]);
  writeCatalogueAtomic(p, text);
  strictEqual(readFileSync(p, "utf-8"), text);
  strictEqual(readFileSync(p, "utf-8").includes("\r\n"), false, "must write LF, never CRLF");
  throws(() => readFileSync(`${p}.tmp`, "utf-8"));
});

test("writeCatalogueAtomic overwrites an existing file", (t) => {
  const dir = tmp(t);
  const p = join(dir, "capcut-catalogue.json");
  writeFileSync(p, "old");
  const text = serializeCatalogue([entry()]);
  writeCatalogueAtomic(p, text);
  strictEqual(readFileSync(p, "utf-8"), text);
});
