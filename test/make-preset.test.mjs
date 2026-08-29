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
  // local witness points at the same downloaded font, but without a resource_id.
  const localPath = "C:/cache/effect/7605/h/SpeedLines.ttf";
  const local = draftWith({ texts: [{ type: "text", font_title: "SpeedLines", font_resource_id: "", font_source_platform: 0, font_path: localPath, fonts: [{ title: "SpeedLines", resource_id: "", source_platform: 0, path: localPath }] }] });
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

// --- buildPreset ------------------------------------------------------------

const candidate = (over = {}) => ({
  resource_id: "7605",
  title: "SpeedLines",
  font_path: "C:/cache/effect/7605/h/SpeedLines.ttf",
  source_platform: 1,
  fonts_entry: { id: "G", resource_id: "7605", category_id: "preset", category_name: "Presets", source_platform: 1, path: "C:/old/path.ttf", effect_id: "7605", title: "SpeedLines", request_id: "REQ-NATIVE" },
  from_drafts: ["dA"],
  ...over,
});

test("buildPreset: emits text_material font identity (title/rid/source_platform/path)", () => {
  const p = buildPreset(candidate());
  strictEqual(p.text_material.font_title, "SpeedLines");
  strictEqual(p.text_material.font_resource_id, "7605");
  strictEqual(p.text_material.font_source_platform, 1);
  strictEqual(p.text_material.font_path, "C:/cache/effect/7605/h/SpeedLines.ttf");
});

test("buildPreset: fonts[] is the draft entry verbatim, path normalized, request_id cleared", () => {
  const p = buildPreset(candidate());
  strictEqual(p.text_material.fonts.length, 1);
  const f = p.text_material.fonts[0];
  strictEqual(f.title, "SpeedLines");
  strictEqual(f.path, "C:/cache/effect/7605/h/SpeedLines.ttf"); // normalized to font_path
  strictEqual(f.request_id, ""); // cleared (CapCut wipes non-empty engine request_ids)
});

test("buildPreset: content_template.styles[0] is font-only (no decoration leaks)", () => {
  const p = buildPreset(candidate());
  deepStrictEqual(p.content_template.styles[0], { font: { path: "C:/cache/effect/7605/h/SpeedLines.ttf", id: "7605" } });
});

test("buildPreset: BARE FONT — segment empty, no shadow/border/name keys", () => {
  const p = buildPreset(candidate());
  deepStrictEqual(p.segment, {});
  strictEqual("has_shadow" in p.text_material, false);
  strictEqual("border_color" in p.text_material, false);
  strictEqual("base_content" in p.text_material, false);
});

test("buildPreset: output round-trips through restyle (the preset is accepted)", () => {
  // Structural contract: restyle reads text_material + content_template + segment.
  const p = buildPreset(candidate());
  ok(p.text_material && p.content_template && p.segment);
  ok(Array.isArray(p.content_template.styles) && p.content_template.styles.length === 1);
});

// --- CLI (envelope / exit codes / --out) ------------------------------------

// Temp drafts-library: root/<name>/draft_content.json. value = draft object.
function makeLib(t, drafts) {
  const root = mkdtempSync(join(tmpdir(), "capcut-makepreset-test-"));
  for (const [name, val] of Object.entries(drafts)) {
    const sub = join(root, name);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "draft_content.json"), typeof val === "string" ? val : JSON.stringify(val));
  }
  if (t && typeof t.after === "function") t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  return root;
}
const libDraft = (mats) => ({ id: "D", name: "n", duration: 1, fps: 30, canvas_config: { width: 1, height: 1, ratio: "9:16" }, tracks: [], materials: mats });
const libFont = (title, rid) => ({ type: "text", font_title: title, font_resource_id: rid, font_source_platform: 1, font_path: `C:/cache/effect/${rid}/h/${title}.ttf`, fonts: [{ id: rid, resource_id: rid, category_id: "preset", category_name: "Presets", source_platform: 1, path: `C:/cache/effect/${rid}/h/${title}.ttf`, effect_id: rid, title, request_id: "REQ" }] });

test("CLI: --font name → status 0, make-preset@1 envelope with font + preset", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json.type, "capcut-david/make-preset@1");
  strictEqual(r.json.ok, true);
  strictEqual(r.json.font.title, "SpeedLines");
  strictEqual(r.json.preset.text_material.font_resource_id, "7605");
});

test("CLI: numeric --font → exact resource_id match", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605"), libFont("Disco", "76050")] }) });
  const r = runCli(["make-preset", "--font", "7605", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.font.resource_id, "7605");
});

test("CLI: --out writes the bare preset file (accepted by restyle's shape)", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const outPath = join(root, "speedlines-preset.json");
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root, "--out", outPath]);
  strictEqual(r.status, 0);
  strictEqual(r.json.written, outPath);
  const preset = JSON.parse(readFileSync(outPath, "utf8"));
  ok(preset.text_material && preset.content_template && preset.segment);
  strictEqual(preset.text_material.font_title, "SpeedLines");
});

test("CLI: missing --font → exit 1, error mentions font", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--drafts", root]);
  strictEqual(r.status, 1);
  ok(/font/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI: --drafts missing dir → exit 2", () => {
  const r = runCli(["make-preset", "--font", "x", "--drafts", join(tmpdir(), "capcut-mp-no-such-dir-xyz")]);
  strictEqual(r.status, 2);
});

test("CLI: no-match → exit 0, ok false, candidates empty", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--font", "nope", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.ok, false);
  strictEqual(r.json.ambiguous, false);
  ok(Array.isArray(r.json.candidates));
});

test("CLI: ambiguous → exit 0, ambiguous true, candidates listed", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("LineArt", "1"), libFont("Lineback", "2")] }) });
  const r = runCli(["make-preset", "--font", "line", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.ambiguous, true);
  strictEqual(r.json.candidates.length, 2);
});

test("CLI: local-only font (no resource_id) → exit 2, refuses", (t) => {
  const local = libDraft({ texts: [{ type: "text", font_title: "MyLocal", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/mylocal.ttf", fonts: [{ title: "MyLocal", resource_id: "", source_platform: 0, path: "C:/win/fonts/mylocal.ttf" }] }] });
  const root = makeLib(t, { dA: local });
  const r = runCli(["make-preset", "--font", "mylocal", "--drafts", root]);
  strictEqual(r.status, 2);
  ok(/resource_id|local/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI: real ken-burns fixture (CC-DerStil) → valid preset", (t) => {
  const root = mkdtempSync(join(tmpdir(), "capcut-mp-fix-"));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const sub = join(root, "ken-burns-draft");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "draft_content.json"), readFileSync(join("test-fixtures", "fixtures", "ken-burns-draft.json"), "utf8"));
  const r = runCli(["make-preset", "--font", "derstil", "--drafts", root]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json.font.title, "CC-DerStil");
  ok(r.json.preset.text_material.fonts[0].title === "CC-DerStil");
});

// FIX 1 — two-phase drafts-root guards
test("CLI: empty library (root exists, no draft subdirs) → exit 0, font null", (t) => {
  const root = mkdtempSync(join(tmpdir(), "capcut-mp-empty-"));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json.type, "capcut-david/make-preset@1");
  strictEqual(r.json.ok, false);
  strictEqual(r.json.font, null);
});

test("CLI: all drafts malformed → exit 2", (t) => {
  const root = makeLib(t, { dA: "{ not json" });
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root]);
  strictEqual(r.status, 2, r.stdout);
  ok(/No readable drafts|parse/.test(r.errorJson?.error ?? r.stderr));
});

// FIX 3 — --human renderer
test("CLI: --human match → stdout contains title + resource_id, no JSON envelope", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605981975781887248")] }) });
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root, "--human"]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json, undefined);
  ok(r.stdout.includes("SpeedLines"), `expected SpeedLines in: ${r.stdout}`);
  ok(r.stdout.includes("7605981975781887248"), `expected rid in: ${r.stdout}`);
});
