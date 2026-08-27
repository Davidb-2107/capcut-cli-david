import { test } from "node:test";
import { strictEqual, throws, deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CatalogueFormatError,
  parseCatalogue,
  serializeCatalogue,
  writeCatalogueAtomic,
} from "../dist/commands/catalogue.js";

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
  classification: "",
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

// The TYPE, not just the message: the whole exit-2 mapping in cmdCatalogue hangs
// off CatalogueFormatError. A revert to die()/CliError must fail here.
test("malformed JSON THROWS CatalogueFormatError — never degrade to an empty catalogue", () => {
  throws(() => parseCatalogue("{ this is not json"), CatalogueFormatError);
});

test("valid JSON of the wrong shape also throws CatalogueFormatError", () => {
  throws(() => parseCatalogue('{"type":"capcut-david/catalogue@1"}'), CatalogueFormatError);
  throws(() => parseCatalogue("[]"), CatalogueFormatError);
});

test("a duplicate id is refused — the merge index would drop one note", () => {
  const text = serializeCatalogue([entry({ note: "A" }), entry({ note: "B" })]);
  throws(() => parseCatalogue(text), CatalogueFormatError);
});

test("a present-but-wrong-typed field is refused, not coerced", () => {
  const one = (over) => JSON.stringify({ type: "capcut-david/catalogue@1", entries: [entry(over)] });
  throws(() => parseCatalogue(one({ note: 42 })), CatalogueFormatError);
  throws(() => parseCatalogue(one({ witness_drafts: ["dA", 7] })), CatalogueFormatError);
  throws(() => parseCatalogue(one({ kinds: "effect" })), CatalogueFormatError);
});

test("serializeCatalogue sorts entries itself — no caller left to remember it", () => {
  const text = serializeCatalogue([entry({ id: "zzz", resource_id: "zzz" }), entry({ id: "aaa", resource_id: "aaa" })]);
  strictEqual(text.indexOf('"aaa"') < text.indexOf('"zzz"'), true);
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
  deepStrictEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
});

test("writeCatalogueAtomic overwrites an existing file", (t) => {
  const dir = tmp(t);
  const p = join(dir, "capcut-catalogue.json");
  writeFileSync(p, "old");
  const text = serializeCatalogue([entry()]);
  writeCatalogueAtomic(p, text);
  strictEqual(readFileSync(p, "utf-8"), text);
});
