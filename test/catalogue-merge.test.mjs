import { test } from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";

import { planCatalogueMerge } from "../dist/commands/catalogue.js";

const TODAY = "2026-08-07";

const raw = (over = {}) => ({
  kind: "effect",
  name: "Vignette",
  resource_id: null,
  effect_id: null,
  category_name: null,
  font_path: null,
  ...over,
});
const seen = (over, draft = "dA") => ({ item: raw(over), draft });

const entry = (over = {}) => ({
  id: "739",
  kinds: ["effect"],
  names: ["Vignette"],
  resource_id: "739",
  effect_id: null,
  font_paths: [],
  first_seen: "2026-01-01",
  witness_drafts: ["dOld"],
  note: "",
  ignored: false,
  merged_from: [],
  ...over,
});

test("1: unknown id is appended with first_seen = today", () => {
  const r = planCatalogueMerge([], [seen({ resource_id: "739" })], TODAY);
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].first_seen, TODAY);
  deepStrictEqual(r.added, ["739"]);
});

test("2: a known id keeps the human's note verbatim", () => {
  const note = "la seule qui rend bien en 9:16";
  const r = planCatalogueMerge([entry({ note })], [seen({ resource_id: "739" })], TODAY);
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].note, note);
  strictEqual(r.entries[0].first_seen, "2026-01-01", "first_seen is never rewritten");
  deepStrictEqual(r.added, []);
});

test("3: witness_drafts is unioned, deduped and codepoint-sorted", () => {
  const r = planCatalogueMerge(
    [entry({ witness_drafts: ["dB"] })],
    [seen({ resource_id: "739" }, "dA"), seen({ resource_id: "739" }, "dB")],
    TODAY,
  );
  deepStrictEqual(r.entries[0].witness_drafts, ["dA", "dB"]);
});

test("4: a vanished witness draft empties the list but keeps the entry", () => {
  const r = planCatalogueMerge([entry({ witness_drafts: ["dGone"], note: "n" })], [], TODAY);
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].witness_drafts, []);
  strictEqual(r.entries[0].note, "n");
});

test("5: ignored:true is never re-fed, even with a live witness", () => {
  const before = entry({ ignored: true, witness_drafts: [], names: ["Vignette"] });
  const r = planCatalogueMerge([before], [seen({ resource_id: "739", name: "Autre" })], TODAY);
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].witness_drafts, [], "an ignored entry is not re-fed");
  deepStrictEqual(r.entries[0].names, ["Vignette"], "an ignored entry is not renamed");
  deepStrictEqual(r.added, []);
});

test("6: PROMOTION — a local font gaining a resource_id keeps its note", () => {
  const local = entry({
    id: "local:c:/f/cc-derstil.ttf",
    kinds: ["font"],
    names: ["CC-DerStil"],
    resource_id: null,
    font_paths: ["c:/f/cc-derstil.ttf"],
    first_seen: "2026-01-01",
    note: "ne pas confondre avec DerStil Pro",
  });
  const r = planCatalogueMerge(
    [local],
    [seen({ kind: "font", name: "CC-DerStil", resource_id: "745", font_path: "C:\\f\\CC-DerStil.ttf" })],
    TODAY,
  );
  strictEqual(r.entries.length, 1, "one font, one entry");
  const e = r.entries[0];
  strictEqual(e.id, "745");
  strictEqual(e.note, "ne pas confondre avec DerStil Pro");
  strictEqual(e.first_seen, "2026-01-01", "the older first_seen survives");
  deepStrictEqual(e.merged_from, ["local:c:/f/cc-derstil.ttf"]);
  deepStrictEqual(r.promoted, ["local:c:/f/cc-derstil.ttf"]);
});

test("7: one resource_id under two locales → one entry, two names", () => {
  const r = planCatalogueMerge(
    [],
    [seen({ resource_id: "672", name: "Fade Out" }, "en"), seen({ resource_id: "672", name: "渐隐" }, "fr")],
    TODAY,
  );
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].names.length, 2);
  ok(r.entries[0].names.includes("Fade Out"));
});

test("8: empty resource_id but distinct effect_id → two entries, no id lost", () => {
  const r = planCatalogueMerge(
    [],
    [
      seen({ resource_id: "", effect_id: "AAA", name: "Glitch" }),
      seen({ resource_id: "", effect_id: "BBB", name: "Glitch" }),
    ],
    TODAY,
  );
  strictEqual(r.entries.length, 2);
  deepStrictEqual(
    r.entries.map((e) => e.effect_id),
    ["AAA", "BBB"],
  );
});

test("9: one filter seen via both routes → one entry, two kinds", () => {
  const r = planCatalogueMerge(
    [],
    [seen({ kind: "effect", resource_id: "670" }, "cutcli"), seen({ kind: "filter", resource_id: "670" }, "ui")],
    TODAY,
  );
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].kinds, ["effect", "filter"]);
});

test("10: entries are codepoint-sorted by id, and a no-op merge is identical", () => {
  const scan = [seen({ resource_id: "739" }), seen({ resource_id: "111" })];
  const first = planCatalogueMerge([], scan, TODAY);
  deepStrictEqual(
    first.entries.map((e) => e.id),
    ["111", "739"],
  );
  const second = planCatalogueMerge(first.entries, scan, TODAY);
  deepStrictEqual(second.entries, first.entries);
  deepStrictEqual(second.added, []);
});
