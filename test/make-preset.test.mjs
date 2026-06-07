// Tests for v1.14.0 `make-preset` — generate a bare-font restyle preset for a
// font found in the drafts library. Spec: docs/superpowers/specs/2026-06-07-make-preset-design.md
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planMakePreset, buildPreset } from "../dist/commands/make-preset.js";
import { runCli } from "./helpers/spawn-cli.mjs";

// --- builders ---------------------------------------------------------------
const draftWith = (materials) => ({ id: "D", name: "n", duration: 1, fps: 30, canvas_config: { width: 1, height: 1, ratio: "9:16" }, tracks: [], materials });
const named = (name, draft) => [{ name, draft }];

// A catalogue font block as it appears inside a draft's materials.texts[].fonts[].
const catFont = (title, rid, extra = {}) => ({
  type: "text",
  font_title: title,
  font_resource_id: rid,
  font_source_platform: 1,
  font_path: `C:/cache/effect/${rid}/h/${title}.ttf`,
  fonts: [{ id: rid, resource_id: rid, third_resource_id: "", category_id: "preset", category_name: "Presets", source_platform: 1, path: `C:/cache/effect/${rid}/h/${title}.ttf`, effect_id: rid, title, team_id: "", file_uri: "", request_id: "REQ-NATIVE", ...extra }],
});

// --- planMakePreset ---------------------------------------------------------

test("plan: name substring match → single catalogue font", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset(named("dA", d), "speed");
  strictEqual(r.status, "match");
  strictEqual(r.font.title, "SpeedLines");
  strictEqual(r.font.resource_id, "7605");
  strictEqual(r.font.source_platform, 1);
  deepStrictEqual(r.font.from_drafts, ["dA"]);
});

test("plan: numeric arg → exact resource_id match (not substring)", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605"), catFont("Disco", "76050")] });
  const r = planMakePreset(named("dA", d), "7605");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, "7605"); // does NOT also match "76050"
});

test("plan: no match → status none", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  strictEqual(planMakePreset(named("dA", d), "nope").status, "none");
});

test("plan: two distinct fonts matched by substring → ambiguous, candidates sorted", () => {
  const d = draftWith({ texts: [catFont("LineArt", "1"), catFont("Lineback", "2")] });
  const r = planMakePreset(named("dA", d), "line");
  strictEqual(r.status, "ambiguous");
  strictEqual(r.candidates.length, 2);
  deepStrictEqual(r.candidates.map((c) => c.title), ["LineArt", "Lineback"]);
});

test("plan: same resource_id across drafts → deduped, from_drafts merged+sorted", () => {
  const mk = () => draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset([{ name: "dB", draft: mk() }, { name: "dA", draft: mk() }], "speed");
  strictEqual(r.status, "match");
  deepStrictEqual(r.font.from_drafts, ["dA", "dB"]);
});

test("plan: prefers catalogue-grade entry over local fallback for same title", () => {
  // local (no rid) and catalogue (rid) both present in different drafts.
  const local = draftWith({ texts: [{ type: "text", font_title: "SpeedLines", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/speed.ttf", fonts: [{ title: "SpeedLines", resource_id: "", source_platform: 0, path: "C:/win/fonts/speed.ttf" }] }] });
  const cat = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset([{ name: "loc", draft: local }, { name: "cat", draft: cat }], "speedlines");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, "7605"); // catalogue wins, not the empty-rid local
});

test("plan: local-only font (no resource_id) is matchable but flagged", () => {
  const d = draftWith({ texts: [{ type: "text", font_title: "MyLocal", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/mylocal.ttf", fonts: [{ title: "MyLocal", resource_id: "", source_platform: 0, path: "C:/win/fonts/mylocal.ttf" }] }] });
  const r = planMakePreset(named("dA", d), "mylocal");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, null);
});

test("plan: entries without a title are skipped; missing texts tolerated", () => {
  const d = draftWith({ texts: [{ type: "text", fonts: [{ resource_id: "9", path: "/x.ttf" }] }] });
  strictEqual(planMakePreset(named("dA", d), "").status, "none");
  strictEqual(planMakePreset(named("dB", draftWith({})), "x").status, "none");
});
