import { test } from "node:test";
import { strictEqual, notStrictEqual } from "node:assert/strict";

import { catalogueId } from "../dist/commands/catalogue.js";

const item = (over = {}) => ({
  kind: "effect",
  name: "Vignette",
  resource_id: null,
  effect_id: null,
  category_name: null,
  font_path: null,
  ...over,
});

test("resource_id wins", () => {
  strictEqual(catalogueId(item({ resource_id: "739", effect_id: "111" })), "739");
});

test("effect_id is the fallback when resource_id is absent", () => {
  strictEqual(catalogueId(item({ effect_id: "111" })), "111");
});

test("empty-string resource_id is treated as absent", () => {
  strictEqual(catalogueId(item({ resource_id: "", effect_id: "111" })), "111");
});

test("kind is NOT in the key: same filter via both routes → one key", () => {
  const viaCutcli = item({ kind: "effect", resource_id: "670" });
  const viaCapCutUi = item({ kind: "filter", resource_id: "670" });
  strictEqual(catalogueId(viaCutcli), catalogueId(viaCapCutUi));
});

test("local font: key is the normalized path, not the name", () => {
  const a = item({ kind: "font", name: "CC-DerStil", font_path: "C:\\Fonts\\CC-DerStil.ttf" });
  const b = item({ kind: "font", name: "cc-derstil", font_path: "c:/fonts/cc-derstil.TTF" });
  strictEqual(catalogueId(a), "local:c:/fonts/cc-derstil.ttf");
  strictEqual(catalogueId(a), catalogueId(b), "separators and case must not split one font");
});

test("no id at all → unresolved, and two names stay distinct", () => {
  strictEqual(catalogueId(item({ name: "Glitch" })), "unresolved:effect|Glitch");
  notStrictEqual(catalogueId(item({ name: "Glitch" })), catalogueId(item({ name: "Blur" })));
});

test("unresolved names are NFC-normalized so NFD/NFC do not split", () => {
  const nfc = item({ name: "\u00c9cho" }); // É precomposed
  const nfd = item({ name: "E\u0301cho" }); // E + combining acute
  strictEqual(catalogueId(nfc), catalogueId(nfd));
});
