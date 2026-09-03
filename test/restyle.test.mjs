// Tests for caption font-mirroring restyle (src/commands/restyle.ts → dist).
// The hard case (kickoff): apply a font/stroke/shadow preset to EVERY span of a
// multi-span keyword caption WITHOUT destroying each span's range or fill.color.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, match } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { applyCaptionStyle, restyleContent, restyleMaterial, spanStyleFromPreset } from "../dist/commands/restyle.js";
import { importCaptions } from "../dist/commands/create.js";
import { loadDraft } from "../dist/draft.js";
import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

// Per-span style block from the CC-DerStil preset (content_template.styles[0]
// minus its own fill + range). This is what restyle grafts onto every span.
const SPAN_STYLE = {
  font: { path: "C:/fonts/CC-DerStil.ttf", id: "7457793217560318481" },
  strokes: [{ content: { render_type: "solid", solid: { color: [0, 0, 0] } }, width: 0.0305, mode: 0 }],
  size: 12,
  shadows: [{ distance: 0, content: { render_type: "solid", solid: { color: [0, 0, 0] } }, angle: 0 }],
  bold: true,
};

const FONT_ONLY_STYLE = {
  font: { path: "C:/fonts/Rubik-Bold.ttf", id: "7517472189348695297" },
};

const WHITE = [1, 1, 1];
const GREEN = [0.20392157137393951, 0.7803921699523926, 0.3490196168422699];

// A real multi-span keyword caption as the engine emits it (code-unit ranges,
// lean spans = fill/size/range only).
function multiSpanContent() {
  return JSON.stringify({
    text: "Au fond de toi",
    styles: [
      { fill: { content: { render_type: "solid", solid: { color: WHITE } } }, size: 15, range: [0, 11] },
      { fill: { content: { render_type: "solid", solid: { color: GREEN } } }, size: 15, range: [11, 14] },
    ],
  });
}

test("restyleContent: multi-span → preserves each span's range and fill.color", () => {
  const out = JSON.parse(restyleContent(multiSpanContent(), SPAN_STYLE));
  strictEqual(out.text, "Au fond de toi");
  strictEqual(out.styles.length, 2, "span count preserved");
  deepStrictEqual(
    out.styles.map((s) => s.range),
    [
      [0, 11],
      [11, 14],
    ],
    "ranges preserved verbatim",
  );
  deepStrictEqual(out.styles[0].fill.content.solid.color, WHITE, "base color survives");
  deepStrictEqual(out.styles[1].fill.content.solid.color, GREEN, "keyword color survives");
});

test("restyleContent: multi-span → grafts font/strokes/shadows/size/bold onto EVERY span", () => {
  const out = JSON.parse(restyleContent(multiSpanContent(), SPAN_STYLE));
  for (const s of out.styles) {
    deepStrictEqual(s.font, SPAN_STYLE.font, "font grafted on every span");
    deepStrictEqual(s.strokes, SPAN_STYLE.strokes, "strokes grafted on every span");
    deepStrictEqual(s.shadows, SPAN_STYLE.shadows, "shadows grafted on every span");
    strictEqual(s.size, 12, "preset size overrides the original span size");
    strictEqual(s.bold, true);
  }
});

test("restyleContent: grafted spans are independent (no shared nested refs)", () => {
  const out = JSON.parse(restyleContent(multiSpanContent(), SPAN_STYLE));
  out.styles[0].strokes[0].width = 999;
  strictEqual(out.styles[1].strokes[0].width, 0.0305, "mutating one span must not affect another");
});

test("restyleContent: single-span lean (byte-length range) → promoted to code-unit range", () => {
  // The engine's legacy single-span path stores range in UTF-16 BYTES.
  const text = "Mais toi tu le sens"; // 19 code units → 38 bytes
  strictEqual(Buffer.from(text, "utf16le").length, 38);
  const lean = JSON.stringify({
    text,
    styles: [{ fill: { content: { render_type: "solid", solid: { color: WHITE } } }, size: 15, range: [0, 38] }],
  });
  const out = JSON.parse(restyleContent(lean, SPAN_STYLE));
  strictEqual(out.styles.length, 1);
  deepStrictEqual(out.styles[0].range, [0, 19], "byte-length range converted to code units");
  deepStrictEqual(out.styles[0].fill.content.solid.color, WHITE, "fill preserved");
  deepStrictEqual(out.styles[0].font, SPAN_STYLE.font, "style grafted");
});

test("restyleContent: font-only preset preserves the existing span size", () => {
  const content = JSON.stringify({
    text: "AA",
    styles: [{ fill: { content: { render_type: "solid", solid: { color: WHITE } } }, size: 10, range: [0, 2] }],
  });
  const out = JSON.parse(restyleContent(content, FONT_ONLY_STYLE));
  strictEqual(out.styles[0].size, 10, "font-only restyle must not erase the caption size");
  deepStrictEqual(out.styles[0].font, FONT_ONLY_STYLE.font, "font identity is still grafted");
});

// --- material-level graft (font_path/fonts[]/shadow_*/border_* + content rebuild) ---

// A lean engine caption material (no font fields), as add-text/import-captions emit.
function leanMaterial() {
  return {
    id: "mat-keep-me",
    type: "text",
    content: JSON.stringify({
      text: "Au fond de toi",
      styles: [
        { fill: { content: { render_type: "solid", solid: { color: WHITE } } }, size: 15, range: [0, 11] },
        { fill: { content: { render_type: "solid", solid: { color: GREEN } } }, size: 15, range: [11, 14] },
      ],
    }),
    font_size: 15,
    text_color: "#FFFFFF",
    base_content: "Au fond de toi",
    recognize_text: "Au fond de toi",
    recognize_task_id: "auto-caption-job-123",
  };
}

// The preset's text_material block (subset) — note its recognize_text/base_content/name
// are EMPTY (a latent bug in restyle.py we must NOT copy: F-19).
const MATERIAL_FIELDS = {
  font_path: "C:/fonts/CC-DerStil.ttf",
  font_resource_id: "7457793217560318481",
  font_title: "CC-DerStil",
  has_shadow: true,
  shadow_color: "#000000",
  border_color: "#000000",
  is_rich_text: true,
  name: "",
  base_content: "",
  recognize_text: "",
  fonts: [{ id: "F1", resource_id: "7457793217560318481", path: "C:/fonts/CC-DerStil.ttf", request_id: "" }],
};

test("restyleMaterial: grafts font_path/fonts[]/shadow on a lean material and rebuilds content", () => {
  const mat = restyleMaterial(leanMaterial(), MATERIAL_FIELDS, SPAN_STYLE);
  strictEqual(mat.font_path, "C:/fonts/CC-DerStil.ttf");
  strictEqual(mat.has_shadow, true);
  strictEqual(mat.is_rich_text, true);
  ok(Array.isArray(mat.fonts) && mat.fonts[0].request_id === "", "fonts[] grafted with empty request_id");
  const styles = JSON.parse(mat.content).styles;
  deepStrictEqual(styles[1].fill.content.solid.color, GREEN, "keyword color survived the material graft");
  deepStrictEqual(styles[0].font, SPAN_STYLE.font, "spans restyled");
});

test("restyleMaterial: preserves id and clears recognize_task_id (F-18)", () => {
  const mat = restyleMaterial(leanMaterial(), MATERIAL_FIELDS, SPAN_STYLE);
  strictEqual(mat.id, "mat-keep-me", "material id preserved");
  strictEqual(mat.recognize_task_id, "", "auto-caption marker cleared");
});

test("restyleMaterial: does NOT blank base_content/recognize_text from the preset (F-19)", () => {
  const mat = restyleMaterial(leanMaterial(), MATERIAL_FIELDS, SPAN_STYLE);
  strictEqual(mat.base_content, "Au fond de toi", "source text not wiped");
  strictEqual(mat.recognize_text, "Au fond de toi", "recognize_text not wiped");
});

test("restyleMaterial: does not mutate the input material", () => {
  const input = leanMaterial();
  restyleMaterial(input, MATERIAL_FIELDS, SPAN_STYLE);
  strictEqual(input.font_path, undefined, "input left untouched (pure)");
});

// --- preset extraction ---

const PRESET = {
  text_material: MATERIAL_FIELDS,
  content_template: {
    text: "modèle",
    styles: [{ fill: { content: { render_type: "solid", solid: { color: WHITE } } }, ...SPAN_STYLE, range: [0, 6] }],
  },
  segment: { render_index: 14000, uniform_scale: { on: true, value: 1 } },
};

test("spanStyleFromPreset: drops fill + range, keeps font/strokes/shadows/size/bold", () => {
  const ss = spanStyleFromPreset(PRESET);
  strictEqual(ss.fill, undefined, "fill dropped (comes from each caption's keyword color)");
  strictEqual(ss.range, undefined, "range dropped (comes from each caption)");
  deepStrictEqual(ss.font, SPAN_STYLE.font);
  strictEqual(ss.size, 12);
  strictEqual(ss.bold, true);
});

// --- orchestration: applyCaptionStyle over a real draft ---

const CARDS = [
  { text: "le PC", start: 0, end: 500000, hl: [3, 5] }, // multi-span
  { text: "est mort", start: 500000, end: 1200000 }, // single-span
];

test("applyCaptionStyle: restyles every reachable caption, preserves keyword colors", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle" });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const reachableIds = track.segments.map((s) => s.material_id);

  const out = applyCaptionStyle(draft, filePath, { preset: PRESET, trackName: "subtitle" });
  strictEqual(out.materialsPatched, 2, "both captions on the track restyled");

  for (const id of reachableIds) {
    const mat = draft.materials.texts.find((m) => m.id === id);
    strictEqual(mat.font_path, "C:/fonts/CC-DerStil.ttf", "font grafted");
    strictEqual(mat.is_rich_text, true);
  }
  // keyword color on "le PC" ([3,5] highlight) survived
  const m0 = draft.materials.texts.find((m) => m.id === reachableIds[0]);
  const s0 = JSON.parse(m0.content).styles;
  strictEqual(s0.length, 2, "multi-span structure intact");
  deepStrictEqual(s0[0].font, SPAN_STYLE.font, "font on every span");
});

test("applyCaptionStyle: leaves orphan (unreferenced) materials untouched — B-8 scoping", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  // Import WITHOUT a track name → replaces the first text track's segments, leaving
  // the fixture's original caption materials orphaned (unreferenced) in materials.texts.
  importCaptions(draft, filePath, { cards: CARDS });
  const orphanIds = new Set(draft.tracks.flatMap((tr) => tr.segments).map((s) => s.material_id));
  const orphans = draft.materials.texts.filter((m) => !orphanIds.has(m.id));
  ok(orphans.length > 0, "fixture import must leave orphans to make this test meaningful");
  const before = orphans.map((o) => JSON.stringify(o));

  applyCaptionStyle(draft, filePath, { preset: PRESET });
  const after = draft.materials.texts.filter((m) => !orphanIds.has(m.id)).map((o) => JSON.stringify(o));
  deepStrictEqual(after, before, "orphan materials must be byte-for-byte unchanged");
});

test("applyCaptionStyle: grafts segment fields without clobbering identity/timing", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle" });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const before = track.segments.map((s) => ({ id: s.id, mat: s.material_id, tr: { ...s.target_timerange } }));

  const out = applyCaptionStyle(draft, filePath, { preset: PRESET, trackName: "subtitle" });
  strictEqual(out.segmentsPatched, 2);
  track.segments.forEach((s, i) => {
    strictEqual(s.id, before[i].id, "segment id preserved");
    strictEqual(s.material_id, before[i].mat, "material_id preserved");
    deepStrictEqual(s.target_timerange, before[i].tr, "timing preserved");
    strictEqual(s.render_index, 14000, "segment field from preset grafted");
  });
});

test("applyCaptionStyle: mirrors the font to sidecars sitting next to the draft", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const dir = dirname(filePath);
  writeFileSync(join(dir, "key_value.json"), JSON.stringify({ existing: { a: 1 } }), "utf-8");
  const { draft } = loadDraft(filePath);
  importCaptions(draft, filePath, { cards: CARDS });

  const out = applyCaptionStyle(draft, filePath, { preset: PRESET });
  ok(out.mirrored.includes("template-2.tmp"), "template-2.tmp written");
  ok(out.mirrored.includes("key_value.json"), "key_value injected");
  ok(existsSync(join(dir, "template-2.tmp")));
  const kv = JSON.parse(readFileSync(join(dir, "key_value.json"), "utf-8"));
  ok(kv["7457793217560318481"], "registry entry injected under the preset resource id");
  ok(kv.existing, "existing registry keys preserved");
});

// --- CLI: restyle <project> --preset <preset.json> ---

test("restyle (CLI): applies preset to captions, font grafted + keyword color preserved", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const cardsPath = join(dirname(filePath), "cards.json");
  writeFileSync(cardsPath, JSON.stringify(CARDS), "utf-8");
  const imp = runCli(["import-captions", filePath, cardsPath]);
  strictEqual(imp.status, 0, imp.stderr);

  const presetPath = join(dirname(filePath), "preset.json");
  writeFileSync(presetPath, JSON.stringify(PRESET), "utf-8");
  const r = runCli(["restyle", filePath, "--preset", presetPath]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  strictEqual(r.json.ok, true);
  strictEqual(r.json.materials_patched, 2);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const track = after.tracks.find((tr) => tr.id === imp.json.track_id);
  const m0 = after.materials.texts.find((m) => m.id === track.segments[0].material_id);
  strictEqual(m0.font_path, "C:/fonts/CC-DerStil.ttf");
  strictEqual(m0.is_rich_text, true);
  deepStrictEqual(JSON.parse(m0.content).styles[0].font, SPAN_STYLE.font);
});

test("restyle (CLI): missing --preset → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const r = runCli(["restyle", filePath]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--preset/);
});

test("restyle (CLI): preset file not found → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const r = runCli(["restyle", filePath, "--preset", join(dirname(filePath), "nope.json")]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /not found/);
});
