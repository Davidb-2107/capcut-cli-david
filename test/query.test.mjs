// Tests for v1.13.0 `query` — read-only catalogue lookup across the CapCut
// drafts library. Finds effects / filters / transitions / fonts by NAME
// (case-insensitive substring) and returns their resource_id. See
// QUERY-kickoff.md for the frozen spec.
//
// Two layers:
//   - pure unit tests on planQuery()/deriveFontName() (deterministic extraction,
//     dedupe, font-name derivation) using synthetic draft objects;
//   - CLI tests via runCli() against a temp drafts-library (exit codes, envelope
//     hygiene, --human, --drafts override, missing/empty/broken roots).
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planQuery, deriveFontName } from "../dist/commands/query.js";
import { runCli } from "./helpers/spawn-cli.mjs";
import { loadFixtureRaw } from "./helpers/load-fixture.mjs";

// --- builders ---------------------------------------------------------------

const draftWith = (materials) => ({
  id: "D",
  name: "n",
  duration: 1,
  fps: 30,
  canvas_config: { width: 1, height: 1, ratio: "9:16" },
  tracks: [],
  materials,
});

// Build a temp drafts-library: root/<name>/draft_content.json for each entry.
// value: { fixture: "<key>" } copies a fixture raw; { raw: "<text>" } writes
// arbitrary content (for malformed-JSON tests); otherwise JSON.stringify(value).
function makeLib(t, drafts) {
  const root = mkdtempSync(join(tmpdir(), "capcut-query-test-"));
  for (const [name, val] of Object.entries(drafts)) {
    const sub = join(root, name);
    mkdirSync(sub, { recursive: true });
    let content;
    if (val && typeof val === "object" && typeof val.fixture === "string") content = loadFixtureRaw(val.fixture);
    else if (val && typeof val === "object" && typeof val.raw === "string") content = val.raw;
    else content = JSON.stringify(val);
    writeFileSync(join(sub, "draft_content.json"), content);
  }
  if (t && typeof t.after === "function") {
    t.after(() => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    });
  }
  return root;
}

const named = (name, draft) => [{ name, draft }];

// ===========================================================================
// deriveFontName — locked single rule (kickoff B6/B7)
// ===========================================================================

test("deriveFontName: strips extension + VariableFont_wght pair", () => {
  strictEqual(deriveFontName("/fixtures/fonts/PlayfairDisplay-VariableFont_wght.ttf"), "PlayfairDisplay");
});
test("deriveFontName: bare name keeps", () => {
  strictEqual(deriveFontName("/fixtures/assets/en.ttf"), "en");
});
test("deriveFontName: strips one trailing weight token", () => {
  strictEqual(deriveFontName("/x/Roboto-Bold.ttf"), "Roboto");
});
test("deriveFontName: does NOT strip arbitrary -word tokens", () => {
  strictEqual(deriveFontName("CC-DerStil.ttf"), "CC-DerStil");
});
test("deriveFontName: handles backslash paths + .otf", () => {
  strictEqual(deriveFontName("C:\\\\fonts\\\\Arial-Italic.otf"), "Arial");
});

// ===========================================================================
// planQuery — pure extraction / match / dedupe (synthetic drafts)
// ===========================================================================

test("RED1b: effect via materials.effects (type != filter)", () => {
  const d = draftWith({ effects: [{ type: "effect", name: "TestEffect", resource_id: "E1", effect_id: "E1", category_name: "Test" }] });
  const r = planQuery(named("dA", d), "test");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "effect");
  strictEqual(r[0].name, "TestEffect");
  strictEqual(r[0].resource_id, "E1");
});

test("RED2: filter via materials.effects (type == filter)", () => {
  const d = draftWith({ effects: [{ type: "filter", name: "Vintage", resource_id: "F1", effect_id: "F1", category_name: "Filters" }] });
  const r = planQuery(named("dA", d), "vint");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "filter");
  strictEqual(r[0].category_name, "Filters");
});

test("RED3: transition via materials.transitions", () => {
  const d = draftWith({ transitions: [{ type: "transition", name: "Dissolve", resource_id: "T1", effect_id: "T1", category_name: "Transitions" }] });
  const r = planQuery(named("dA", d), "dissolve");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "transition");
  strictEqual(r[0].resource_id, "T1");
  strictEqual(r[0].effect_id, "T1");
});

test("RED4: font from fonts[].title (resource_id non-null)", () => {
  const d = draftWith({ texts: [{ type: "text", fonts: [{ title: "CC-DerStil", resource_id: "7457", effect_id: "7457", category_name: "Presets", path: "/c/CC-DerStil.ttf" }] }] });
  const r = planQuery(named("dA", d), "derstil");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "font");
  strictEqual(r[0].name, "CC-DerStil");
  strictEqual(r[0].resource_id, "7457");
});

test("RED5: local font fallback (no resource_id) derives name + echoes font_path", () => {
  const d = draftWith({ texts: [{ type: "text", font_path: "/x/PlayfairDisplay-VariableFont_wght.ttf", font_resource_id: "" }] });
  const r = planQuery(named("dA", d), "playfair");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "font");
  strictEqual(r[0].name, "PlayfairDisplay");
  strictEqual(r[0].resource_id, null);
  strictEqual(r[0].font_path, "/x/PlayfairDisplay-VariableFont_wght.ttf");
});

test("RED6: case-insensitive substring match", () => {
  const d = draftWith({ transitions: [{ type: "transition", name: "Dissolve", resource_id: "T1", effect_id: "T1" }] });
  strictEqual(planQuery(named("dA", d), "SOLVE").length, 1);
  strictEqual(planQuery(named("dA", d), "dissolve").length, 1);
  strictEqual(planQuery(named("dA", d), "zzz").length, 0);
});

test("RED7/zero: no matches → empty array", () => {
  const d = draftWith({ transitions: [{ type: "transition", name: "Dissolve", resource_id: "T1" }] });
  deepStrictEqual(planQuery(named("dA", d), "nope"), []);
});

test("RED8: --kind filter isolates one kind", () => {
  const d = draftWith({
    effects: [
      { type: "effect", name: "edge-fx", resource_id: "E1", effect_id: "E1" },
      { type: "filter", name: "edge-filter", resource_id: "F1", effect_id: "F1" },
    ],
    transitions: [{ type: "transition", name: "edge-trans", resource_id: "T1", effect_id: "T1" }],
    texts: [{ type: "text", font_path: "/x/edge.ttf", font_resource_id: "" }],
  });
  const all = planQuery(named("dA", d), "edge");
  strictEqual(all.length, 4);
  for (const k of ["effect", "filter", "transition", "font"]) {
    const only = planQuery(named("dA", d), "edge", k);
    strictEqual(only.length, 1, `--kind ${k} should isolate one`);
    strictEqual(only[0].kind, k);
  }
});

test("RED10: dedupe by resource_id across drafts → one result, from_drafts merged+sorted", () => {
  const mk = () => draftWith({ transitions: [{ type: "transition", name: "Dissolve", resource_id: "RES123", effect_id: "RES123" }] });
  const r = planQuery([{ name: "draftB", draft: mk() }, { name: "draftA", draft: mk() }], "dissolve");
  strictEqual(r.length, 1);
  deepStrictEqual(r[0].from_drafts, ["draftA", "draftB"]);
});

test("RED11: different resource_ids are NOT deduped", () => {
  const a = draftWith({ effects: [{ type: "effect", name: "Blur", resource_id: "RES_A", effect_id: "RES_A" }] });
  const b = draftWith({ effects: [{ type: "effect", name: "Blur", resource_id: "RES_B", effect_id: "RES_B" }] });
  const r = planQuery([{ name: "a", draft: a }, { name: "b", draft: b }], "blur");
  strictEqual(r.length, 2);
});

test("RED12: local font dedupe by name+path across drafts", () => {
  const mk = () => draftWith({ texts: [{ type: "text", font_path: "/sys/arial.ttf", font_resource_id: "" }] });
  const r = planQuery([{ name: "a", draft: mk() }, { name: "b", draft: mk() }], "arial");
  strictEqual(r.length, 1);
  strictEqual(r[0].resource_id, null);
  strictEqual(r[0].from_drafts.length, 2);
});

test("RED13: same font name, different path → NOT deduped", () => {
  const a = draftWith({ texts: [{ type: "text", font_path: "/sys/arial.ttf", font_resource_id: "" }] });
  const b = draftWith({ texts: [{ type: "text", font_path: "/custom/arial.ttf", font_resource_id: "" }] });
  const r = planQuery([{ name: "a", draft: a }, { name: "b", draft: b }], "arial");
  strictEqual(r.length, 2);
});

test("RED23: video_effects folded into kind effect", () => {
  const d = draftWith({ effects: [], video_effects: [{ name: "Glow", resource_id: "G1", effect_id: "G1" }] });
  const r = planQuery(named("dA", d), "glow");
  strictEqual(r.length, 1);
  strictEqual(r[0].kind, "effect");
  strictEqual(r[0].resource_id, "G1");
});

test("planQuery: nameless entries are skipped; missing material slots tolerated", () => {
  const d = draftWith({ effects: [{ type: "effect", resource_id: "E1" }], transitions: undefined });
  deepStrictEqual(planQuery(named("dA", d), ""), []);
});

// ===========================================================================
// CLI — exit codes / envelope / --human / library roots (real fixtures)
// ===========================================================================

test("CLI RED1: effect by name from real effects-draft video_effects → status 0, envelope", (t) => {
  const root = makeLib(t, { "effects-draft": { fixture: "effects-draft" } });
  const r = runCli(["query", "vhs", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.type, "capcut-david/query@1");
  ok(Array.isArray(r.json.results));
  ok(r.json.results.length >= 1);
  strictEqual(r.json.results[0].kind, "effect");
  deepStrictEqual(r.json.results[0].from_drafts, ["effects-draft"]);
});

test("CLI: filter from masks-filters-draft", (t) => {
  const root = makeLib(t, { "masks-filters-draft": { fixture: "masks-filters-draft" } });
  const r = runCli(["query", "vintage", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.results[0].kind, "filter");
  strictEqual(r.json.results[0].name, "Vintage");
});

test("CLI: transition from transitions-draft", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "dissolve", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.results[0].kind, "transition");
  ok(r.json.results[0].resource_id);
});

test("CLI RED4: font from real ken-burns-draft fonts[].title (CC-DerStil)", (t) => {
  const root = makeLib(t, { "ken-burns-draft": { fixture: "ken-burns-draft" } });
  const r = runCli(["query", "derstil", "--drafts", root]);
  strictEqual(r.status, 0);
  const font = r.json.results.find((x) => x.kind === "font");
  ok(font, "expected a font result");
  strictEqual(font.name, "CC-DerStil");
  ok(font.resource_id);
});

test("CLI RED7: zero matches → exit 0, empty results", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "zzznope", "--drafts", root]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json.results, []);
});

test("CLI RED8: --kind isolates", (t) => {
  const root = makeLib(t, { "masks-filters-draft": { fixture: "masks-filters-draft" }, "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "i", "--kind", "transition", "--drafts", root]);
  strictEqual(r.status, 0);
  ok(r.json.results.every((x) => x.kind === "transition"));
});

test("CLI RED9: invalid --kind → exit 1, error mentions kind", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "x", "--kind", "bogus", "--drafts", root]);
  strictEqual(r.status, 1);
  ok(/kind/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI RED15: --drafts missing dir → exit 2", () => {
  const r = runCli(["query", "x", "--drafts", join(tmpdir(), "capcut-query-nonexistent-zzz-9988")]);
  strictEqual(r.status, 2);
  ok(/root/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI RED16: malformed draft skipped, scan continues → exit 0", (t) => {
  const root = makeLib(t, {
    good: { fixture: "transitions-draft" },
    bad: { raw: "{ this is not valid json " },
  });
  const r = runCli(["query", "dissolve", "--drafts", root]);
  strictEqual(r.status, 0);
  ok(r.json.results.some((x) => x.kind === "transition"));
});

test("CLI RED17: ALL drafts unreadable → exit 2", (t) => {
  const root = makeLib(t, { bad: { raw: "nope not json" } });
  const r = runCli(["query", "x", "--drafts", root]);
  strictEqual(r.status, 2);
});

test("CLI RED18: empty library (root exists, no draft folders) → exit 0", (t) => {
  const root = makeLib(t, {});
  const r = runCli(["query", "x", "--drafts", root]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json.results, []);
});

test("CLI RED19: envelope hygiene — no next, no stats", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "dissolve", "--drafts", root]);
  strictEqual(r.json.type, "capcut-david/query@1");
  strictEqual(r.json.next, undefined);
  strictEqual(r.json.stats, undefined);
});

test("CLI RED20: missing <term> → exit 1, error mentions term", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "--drafts", root]);
  strictEqual(r.status, 1);
  ok(/term/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI RED21: --human table → not JSON, has header + row", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "dissolve", "--drafts", root, "--human"]);
  strictEqual(r.status, 0);
  strictEqual(r.json, undefined);
  ok(/KIND/.test(r.stdout) && /NAME/.test(r.stdout));
  ok(/Dissolve/.test(r.stdout));
});

test("CLI RED22: --human zero matches → 'No matches.'", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "zzz", "--drafts", root, "--human"]);
  strictEqual(r.status, 0);
  ok(/No matches\./.test(r.stdout));
});

// ===========================================================================
// --all — inventaire complet (2.6.0)
// ===========================================================================

test("CLI: --all sans terme → liste tout, exit 0", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const withTerm = runCli(["query", "dissolve", "--drafts", root]);
  const all = runCli(["query", "--all", "--drafts", root]);
  strictEqual(all.status, 0);
  ok(all.json.results.length >= withTerm.json.results.length);
  ok(all.json.results.length > 0);
});

test("CLI: --all respecte --kind", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "--all", "--kind", "transition", "--drafts", root]);
  strictEqual(r.status, 0);
  ok(r.json.results.length > 0);
  ok(r.json.results.every((it) => it.kind === "transition"));
});

test("CLI: sans --all et sans terme → toujours exit 1", (t) => {
  const root = makeLib(t, { "transitions-draft": { fixture: "transitions-draft" } });
  const r = runCli(["query", "--drafts", root]);
  strictEqual(r.status, 1);
});

test("CLI: a BOM'd draft is scanned, not silently skipped", (t) => {
  const root = makeLib(t, {
    "bom-draft": { raw: `﻿${loadFixtureRaw("transitions-draft")}` },
  });
  const r = runCli(["query", "--all", "--drafts", root]);
  strictEqual(r.status, 0);
  ok(r.json.results.length > 0, "a BOM must not make the draft invisible");
});
