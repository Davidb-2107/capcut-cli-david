// Tests for keyword-highlight rich-text (src/commands/create.ts → dist).
// Covers: buildRichTextContent core (code-unit ranges, float32 color, contiguity,
// validation) + addText highlight wiring + byte-identity of the no-highlight path.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, throws, match } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { addText, buildRichTextContent, importCaptions } from "../dist/commands/create.js";
import { hexToRgb } from "../dist/utils/companion.js";
import { loadDraft, saveDraft } from "../dist/draft.js";

import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const WHITE = [1, 1, 1];
// Restored oracle text + purple keyword captured from CapCut UI (animations-draft).
const ORACLE_TEXT = "THE EYES ARE WATCHING ME."; // 25 UTF-16 code units
const PURPLE_HEX = "#8C6CFF";
const ORACLE_PURPLE = [0.5490196347236633, 0.42352941632270813, 1]; // float32

function styles(content) {
  return JSON.parse(content).styles;
}

// =============================================================
// buildRichTextContent — core
// =============================================================

test("buildRichTextContent: mid-text highlight → 3 contiguous spans matching the CapCut oracle", () => {
  const content = buildRichTextContent(ORACLE_TEXT, 15, WHITE, [
    { range: [13, 21], color: hexToRgb(PURPLE_HEX) },
  ]);
  const parsed = JSON.parse(content);
  strictEqual(parsed.text, ORACLE_TEXT);
  const s = parsed.styles;
  strictEqual(s.length, 3, "mid-text keyword → before/keyword/after");
  deepStrictEqual(s.map((x) => x.range), [
    [0, 13],
    [13, 21],
    [21, 25],
  ]);
  // colors: white / purple / white — purple must equal the real CapCut float32 capture
  deepStrictEqual(s[0].fill.content.solid.color, WHITE);
  deepStrictEqual(s[1].fill.content.solid.color, ORACLE_PURPLE);
  deepStrictEqual(s[2].fill.content.solid.color, WHITE);
  // functional/patcher shape: no alpha, no useLetterColor
  strictEqual(s[1].useLetterColor, undefined);
  strictEqual(s[1].fill.alpha, undefined);
  strictEqual(s[1].fill.content.solid.alpha, undefined);
  strictEqual(s[1].size, 15);
});

test("buildRichTextContent: oracle float32 purple is exactly fround(#8C6CFF)", () => {
  const expected = hexToRgb(PURPLE_HEX).map((c) => Math.fround(c));
  deepStrictEqual(expected, ORACLE_PURPLE);
});

test("buildRichTextContent: keyword at start → 2 spans (keyword + after)", () => {
  const text = "WATCHING eyes";
  const s = styles(buildRichTextContent(text, 15, WHITE, [{ range: [0, 8], color: hexToRgb(PURPLE_HEX) }]));
  strictEqual(s.length, 2);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 8],
    [8, text.length],
  ]);
  deepStrictEqual(s[0].fill.content.solid.color, ORACLE_PURPLE);
  deepStrictEqual(s[1].fill.content.solid.color, WHITE);
});

test("buildRichTextContent: keyword at end → 2 spans (before + keyword)", () => {
  const text = "eyes WATCHING";
  const s = styles(buildRichTextContent(text, 15, WHITE, [{ range: [5, 13], color: hexToRgb(PURPLE_HEX) }]));
  strictEqual(s.length, 2);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 5],
    [5, 13],
  ]);
});

test("buildRichTextContent: no highlights → single span over [0, len]", () => {
  const text = "plain caption";
  const s = styles(buildRichTextContent(text, 15, WHITE, []));
  strictEqual(s.length, 1);
  deepStrictEqual(s[0].range, [0, text.length]);
  deepStrictEqual(s[0].fill.content.solid.color, WHITE);
});

test("buildRichTextContent: ranges are contiguous, non-overlapping, cover the whole text", () => {
  const text = "alpha bravo charlie delta";
  const s = styles(
    buildRichTextContent(text, 15, WHITE, [
      { range: [6, 11], color: hexToRgb("#FF0000") },
      { range: [12, 19], color: hexToRgb("#00FF00") },
    ]),
  );
  // sum of span lengths == text length, and each span starts where the previous ended
  let cursor = 0;
  let sum = 0;
  for (const sp of s) {
    strictEqual(sp.range[0], cursor, "span must start where previous ended");
    cursor = sp.range[1];
    sum += sp.range[1] - sp.range[0];
  }
  strictEqual(cursor, text.length, "spans must end at text length");
  strictEqual(sum, text.length, "sum of ranges == text length");
});

test("buildRichTextContent: ranges count in UTF-16 code units (emoji surrogate pair = 2)", () => {
  // "👁" is U+1F441, a surrogate pair → 2 code units. "EYES" therefore starts at
  // code-unit index 3 (emoji=2 + space=1), which is what CapCut expects.
  const text = "👁 EYES";
  strictEqual(text.length, 7); // 2 (emoji) + 1 (space) + 4 (EYES)
  const kw = "EYES";
  const start = text.indexOf(kw); // 3 — JS indexOf is code-unit based
  strictEqual(start, 3);
  const s = styles(buildRichTextContent(text, 15, WHITE, [{ range: [start, start + kw.length], color: hexToRgb(PURPLE_HEX) }]));
  deepStrictEqual(s.map((x) => x.range), [
    [0, 3],
    [3, 7],
  ]);
});

test("buildRichTextContent: invalid range throws CliError", () => {
  throws(() => buildRichTextContent("short", 15, WHITE, [{ range: [2, 99], color: WHITE }]), /Invalid highlight range/);
  throws(() => buildRichTextContent("short", 15, WHITE, [{ range: [3, 1], color: WHITE }]), /Invalid highlight range/);
});

test("buildRichTextContent: overlapping ranges throw CliError", () => {
  throws(
    () =>
      buildRichTextContent("hello world", 15, WHITE, [
        { range: [0, 6], color: WHITE },
        { range: [3, 9], color: WHITE },
      ]),
    /Overlapping highlight ranges/,
  );
});

// =============================================================
// addText — highlight wiring + byte-identity of the no-highlight path
// =============================================================

test("addText: with highlights writes is_rich_text + multi-span content", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const result = addText(draft, filePath, {
    text: ORACLE_TEXT,
    start: 0,
    duration: 2_000_000,
    fontSize: 15,
    highlights: [{ range: [13, 21], color: hexToRgb(PURPLE_HEX) }],
  });
  const mat = draft.materials.texts.find((m) => m.id === result.materialId);
  ok(mat);
  strictEqual(mat.is_rich_text, true, "highlight material must declare is_rich_text");
  strictEqual(styles(mat.content).length, 3);
});

test("addText: WITHOUT highlights stays byte-identical to v1.3.0 (single octet span, no is_rich_text)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const text = "Test caption";
  const result = addText(draft, filePath, { text, start: 0, duration: 2_000_000, fontSize: 24, color: "#FF0000" });
  const mat = draft.materials.texts.find((m) => m.id === result.materialId);
  ok(mat);
  strictEqual("is_rich_text" in mat, false, "no-highlight path must NOT add is_rich_text");
  const s = styles(mat.content);
  strictEqual(s.length, 1);
  // legacy single-span range is in UTF-16 BYTES (utf16le length) — frozen contract
  strictEqual(s[0].range[1], Buffer.from(text, "utf16le").length);
});

// =============================================================
// Surface A — add-text --keyword / --keyword-range / --keyword-color (CLI)
// =============================================================

const DEFAULT_YELLOW = [1, Math.fround(214 / 255), 0]; // #FFD600 fround float32

function lastTextMaterial(filePath, id) {
  const draft = JSON.parse(readFileSync(filePath, "utf-8"));
  return draft.materials.texts.find((m) => m.id === id);
}

test("add-text --keyword (CLI): substring → 3 spans, default yellow, is_rich_text", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "THE", "EYES", "ARE", "WATCHING", "ME.", "--keyword", "WATCHING"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const mat = lastTextMaterial(filePath, r.json.material_id);
  strictEqual(mat.is_rich_text, true);
  const s = styles(mat.content);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 13],
    [13, 21],
    [21, 25],
  ]);
  deepStrictEqual(s[1].fill.content.solid.color, DEFAULT_YELLOW);
});

test("add-text --keyword-range (CLI): explicit code-unit offsets", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "THE EYES ARE WATCHING ME.", "--keyword-range", "13,21"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const s = styles(lastTextMaterial(filePath, r.json.material_id).content);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 13],
    [13, 21],
    [21, 25],
  ]);
});

test("add-text --keyword-color (CLI): custom hex applied as float32", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "danger zone", "--keyword", "danger", "--keyword-color", "#FF0000"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const s = styles(lastTextMaterial(filePath, r.json.material_id).content);
  deepStrictEqual(s[0].fill.content.solid.color, [1, 0, 0]);
  deepStrictEqual(s[0].range, [0, 6]);
});

test("add-text --keyword-range wins over --keyword (precedence)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "alpha bravo", "--keyword", "alpha", "--keyword-range", "6,11"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const s = styles(lastTextMaterial(filePath, r.json.material_id).content);
  // range-based [6,11] → before [0,6] + keyword [6,11]; NOT the "alpha" [0,5]
  deepStrictEqual(s.map((x) => x.range), [
    [0, 6],
    [6, 11],
  ]);
});

test("add-text --keyword (CLI): substring not found → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "hello world", "--keyword", "zzz"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--keyword "zzz" not found/);
});

test("add-text --keyword-range (CLI): out-of-bounds → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "short", "--keyword-range", "2,99"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Invalid highlight range/);
});

// =============================================================
// Surface B — import-captions (batch JSON → replaces a text track)
// =============================================================

const CARDS = [
  { text: "le PC", start: 0, end: 500000, hl: [3, 5] }, // "PC" highlighted
  { text: "est mort", start: 500000, end: 1200000 }, // no highlight
  { text: "DANGER zone", start: 1200000, end: 2000000, hl: [0, 6], color: "#FF0000" },
];

test("importCaptions: replaces text track with N cards; hl→rich, no-hl→single span", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle" });
  strictEqual(res.count, 3);
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  strictEqual(track.segments.length, 3, "track segments fully replaced");

  const matOf = (i) => draft.materials.texts.find((m) => m.id === track.segments[i].material_id);
  // card 0: "le PC" with hl [3,5] → 2 spans (before + keyword), rich
  strictEqual(matOf(0).is_rich_text, true);
  deepStrictEqual(styles(matOf(0).content).map((x) => x.range), [
    [0, 3],
    [3, 5],
  ]);
  // card 1: no hl → single span, NOT rich
  strictEqual("is_rich_text" in matOf(1), false);
  strictEqual(styles(matOf(1).content).length, 1);
  // card 2: per-card color override (#FF0000)
  deepStrictEqual(styles(matOf(2).content)[0].fill.content.solid.color, [1, 0, 0]);
});

test("importCaptions: duration = max(1, end-start); timing on segments", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle" });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  strictEqual(track.segments[0].target_timerange.start, 0);
  strictEqual(track.segments[0].target_timerange.duration, 500000);
  strictEqual(track.segments[1].target_timerange.duration, 700000);
});

test("importCaptions: hl [0,0] (patcher sentinel) → no highlight, single span", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "no keyword here", start: 0, end: 1000000, hl: [0, 0] }],
    trackName: "subtitle",
  });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const mat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  strictEqual("is_rich_text" in mat, false);
  strictEqual(styles(mat.content).length, 1);
});

test("import-captions (CLI happy): reads JSON, replaces track, returns count", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "captions-styled.json");
  writeFileSync(jsonPath, JSON.stringify(CARDS), "utf-8");
  const r = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  strictEqual(r.json.ok, true);
  strictEqual(r.json.captions, 3);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const track = after.tracks.find((tr) => tr.id === r.json.track_id);
  strictEqual(track.segments.length, 3);
});

test("import-captions (CLI): --highlight-color sets the global default", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "cap2.json");
  writeFileSync(jsonPath, JSON.stringify([{ text: "buy now", start: 0, end: 1000000, hl: [0, 3] }]), "utf-8");
  const r = runCli(["import-captions", filePath, jsonPath, "--highlight-color", "#00FF00", "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const track = after.tracks.find((tr) => tr.id === r.json.track_id);
  const mat = after.materials.texts.find((m) => m.id === track.segments[0].material_id);
  deepStrictEqual(styles(mat.content)[0].fill.content.solid.color, [0, 1, 0]);
});

test("import-captions (CLI): missing file → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const r = runCli(["import-captions", filePath, join(dirname(filePath), "does-not-exist.json")]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Captions file not found/);
});

test("import-captions (CLI): bad range in a card → CliError status 1", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "bad.json");
  writeFileSync(jsonPath, JSON.stringify([{ text: "hi", start: 0, end: 1000000, hl: [0, 99] }]), "utf-8");
  const r = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /Invalid highlight range/);
});

// =============================================================
// Guard — set-text must refuse to corrupt a multi-span caption
// =============================================================

test("set-text (CLI): refuses a multi-span (keyword-highlight) caption", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft, filePath: fp } = loadDraft(filePath);
  const r = addText(draft, fp, {
    text: "DANGER zone",
    start: 0,
    duration: 1_000_000,
    highlights: [{ range: [0, 6], color: hexToRgb("#FF0000") }],
  });
  saveDraft(fp, draft);
  const res = runCli(["set-text", filePath, r.segmentId, "new plain text"]);
  strictEqual(res.status, 1);
  ok(res.errorJson, `expected JSON on stderr, got: ${res.stderr}`);
  match(res.errorJson.error, /multi-span/);
});

test("set-text (CLI): still works on a normal single-span caption", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft, filePath: fp } = loadDraft(filePath);
  const r = addText(draft, fp, { text: "hello", start: 0, duration: 1_000_000 });
  saveDraft(fp, draft);
  const res = runCli(["set-text", filePath, r.segmentId, "goodbye"]);
  strictEqual(res.status, 0, `unexpected stderr: ${res.stderr}`);
  strictEqual(res.json.new, "goodbye");
});

test("add-text --keyword-range (CLI): non-integer offset rejected (no silent truncation)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "alpha bravo", "--keyword-range", "1.5,3"]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /two integers/);
});

// =============================================================
// v1.5.0 — --clone-style: photocopy an existing caption's style (font-agnostic)
// =============================================================

const FAKE_STYLE = {
  font: { path: "C:\Fonts\TotallyUnknownFont.ttf", id: "fake-font-id" },
  strokes: [{ content: { solid: { color: [0, 0, 0] } }, width: 0.08 }],
  shadows: [{ content: { solid: { color: [0, 0, 0] } }, alpha: 0.9 }],
  size: 22,
  bold: true,
  range: [0, 5],
  fill: { content: { render_type: "solid", solid: { color: [1, 1, 1] } } },
};

test("buildRichTextContent baseStyle: clones font/strokes/shadows/size onto every span, only range+fill change", () => {
  const s = styles(buildRichTextContent("le PC", 15, WHITE, [{ range: [3, 5], color: hexToRgb("#FFD600") }], FAKE_STYLE));
  strictEqual(s.length, 2);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 3],
    [3, 5],
  ]);
  for (const sp of s) {
    deepStrictEqual(sp.font, FAKE_STYLE.font, "unknown font copied verbatim");
    deepStrictEqual(sp.strokes, FAKE_STYLE.strokes, "stroke preserved on each span");
    deepStrictEqual(sp.shadows, FAKE_STYLE.shadows, "shadow preserved on each span");
    strictEqual(sp.size, 22, "cloned size wins over the fontSize param");
    strictEqual(sp.bold, true);
  }
  // the keyword span gets the highlight color ON the cloned (unknown) font
  deepStrictEqual(s[1].fill.content.solid.color, DEFAULT_YELLOW);
  deepStrictEqual(s[0].fill.content.solid.color, WHITE);
});

test("buildRichTextContent baseStyle: spans are independent (no shared nested refs)", () => {
  const s = styles(buildRichTextContent("ab cd", 15, WHITE, [{ range: [0, 2], color: hexToRgb("#FF0000") }], FAKE_STYLE));
  s[0].strokes[0].width = 999; // mutate one span
  strictEqual(s[1].strokes[0].width, 0.08, "other span's stroke must be unaffected");
});

test("buildRichTextContent: WITHOUT baseStyle the lean default span shape is unchanged (byte-identity guard)", () => {
  const s = styles(buildRichTextContent("le PC", 15, WHITE, [{ range: [3, 5], color: hexToRgb("#FFD600") }]));
  // lean shape: only fill/size/range, no font/strokes/shadows
  deepStrictEqual(Object.keys(s[0]).sort(), ["fill", "range", "size"]);
});

test("importCaptions --clone-style: new captions inherit the existing caption's unknown font + stroke", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  // Plant a known style block (unknown font) on the target track's first caption.
  const track = draft.tracks.find((tr) => tr.type === "text");
  ok(track && track.segments[0], "fixture must have a text track with a caption");
  const tplMat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  tplMat.content = JSON.stringify({ text: "modèle", styles: [FAKE_STYLE] });

  // No --track-name → defaults to the first text track (the one we just planted on).
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "le PC", start: 0, end: 500000, hl: [3, 5] }],
    cloneStyle: true,
  });
  strictEqual(res.trackId, track.id, "should target the existing first text track, not create a new one");
  const newTrack = draft.tracks.find((tr) => tr.id === res.trackId);
  const mat = draft.materials.texts.find((m) => m.id === newTrack.segments[0].material_id);
  strictEqual(mat.is_rich_text, true);
  const s = styles(mat.content);
  deepStrictEqual(s[1].font, FAKE_STYLE.font, "unknown font cloned onto the new caption");
  ok(Array.isArray(s[1].strokes), "stroke cloned");
  deepStrictEqual(s[1].fill.content.solid.color, DEFAULT_YELLOW, "highlight color sits on the cloned font");
});

test("importCaptions --clone-style: empty/absent track falls back to default style (no crash, no font)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  // MINIMAL has no "subtitle" track → clone has nothing to copy → default style fallback.
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "hello world", start: 0, end: 1000000, hl: [0, 5] }],
    trackName: "subtitle",
    cloneStyle: true,
  });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const mat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  const s = styles(mat.content);
  strictEqual(s[0].font, undefined, "fallback default span has no cloned font");
  deepStrictEqual(Object.keys(s[0]).sort(), ["fill", "range", "size"]);
});

test("import-captions --clone-style (CLI): runs and clones style end-to-end", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const track = draft.tracks.find((tr) => tr.type === "text");
  const tplMat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  tplMat.content = JSON.stringify({ text: "modèle", styles: [FAKE_STYLE] });
  saveDraft(filePath, draft);

  const jsonPath = join(dirname(filePath), "clone-cards.json");
  writeFileSync(jsonPath, JSON.stringify([{ text: "le PC", start: 0, end: 500000, hl: [3, 5] }]), "utf-8");
  const r = runCli(["import-captions", filePath, jsonPath, "--clone-style"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const newTrack = after.tracks.find((tr) => tr.id === r.json.track_id);
  const mat = after.materials.texts.find((m) => m.id === newTrack.segments[0].material_id);
  deepStrictEqual(styles(mat.content)[1].font, FAKE_STYLE.font);
});

// =============================================================
// v1.15.0 — per-word highlight SIZE (TextHighlight.size / hlSize / --keyword-size / --highlight-size)
// =============================================================

// Byte-identity oracles: exact output of v1.14.1 dist for a size-LESS highlight,
// captured before the size feature landed. These strings must never change.
const ORACLE_LEAN_NO_SIZE =
  '{"text":"le PC","styles":[{"fill":{"content":{"render_type":"solid","solid":{"color":[1,1,1]}}},"size":15,"range":[0,3]},{"fill":{"content":{"render_type":"solid","solid":{"color":[1,0.8392156958580017,0]}}},"size":15,"range":[3,5]}]}';
const ORACLE_CLONE_NO_SIZE =
  '{"text":"le PC","styles":[{"font":{"path":"C:FontsTotallyUnknownFont.ttf","id":"fake-font-id"},"strokes":[{"content":{"solid":{"color":[0,0,0]}},"width":0.08}],"shadows":[{"content":{"solid":{"color":[0,0,0]}},"alpha":0.9}],"size":22,"bold":true,"range":[0,3],"fill":{"content":{"render_type":"solid","solid":{"color":[1,1,1]}}}},{"font":{"path":"C:FontsTotallyUnknownFont.ttf","id":"fake-font-id"},"strokes":[{"content":{"solid":{"color":[0,0,0]}},"width":0.08}],"shadows":[{"content":{"solid":{"color":[0,0,0]}},"alpha":0.9}],"size":22,"bold":true,"range":[3,5],"fill":{"content":{"render_type":"solid","solid":{"color":[1,0.8392156958580017,0]}}}}]}';

test("byte-identity: highlight WITHOUT size → lean output byte-identical to v1.14.1", () => {
  const content = buildRichTextContent("le PC", 15, WHITE, [{ range: [3, 5], color: hexToRgb("#FFD600") }]);
  strictEqual(content, ORACLE_LEAN_NO_SIZE);
});

test("byte-identity: highlight WITHOUT size → clone (baseStyle) output byte-identical to v1.14.1", () => {
  const content = buildRichTextContent(
    "le PC",
    15,
    WHITE,
    [{ range: [3, 5], color: hexToRgb("#FFD600") }],
    FAKE_STYLE,
  );
  strictEqual(content, ORACLE_CLONE_NO_SIZE);
});

test("buildRichTextContent: highlight WITH size → emphasis span gets size, base/gap spans keep fontSize (lean)", () => {
  const s = styles(
    buildRichTextContent("le PC", 15, WHITE, [{ range: [3, 5], color: hexToRgb("#FFD600"), size: 28 }]),
  );
  strictEqual(s.length, 2);
  strictEqual(s[0].size, 15, "base span keeps the base fontSize");
  strictEqual(s[1].size, 28, "emphasis span carries the highlight size");
  deepStrictEqual(Object.keys(s[1]).sort(), ["fill", "range", "size"], "lean span shape unchanged");
});

test("buildRichTextContent: highlight WITH size overrides the cloned size on the emphasis span only (clone)", () => {
  const s = styles(
    buildRichTextContent("le PC", 15, WHITE, [{ range: [3, 5], color: hexToRgb("#FFD600"), size: 28 }], FAKE_STYLE),
  );
  strictEqual(s[0].size, 22, "non-emphasis span keeps the cloned size");
  strictEqual(s[1].size, 28, "emphasis span size overrides the clone");
  deepStrictEqual(s[1].font, FAKE_STYLE.font, "clone keys survive next to the size override");
  deepStrictEqual(s[1].strokes, FAKE_STYLE.strokes);
});

test("importCaptions: per-card hlSize wins over global highlightSize; global is the fallback", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: [
      { text: "le PC", start: 0, end: 500000, hl: [3, 5], hlSize: 30 },
      { text: "est mort", start: 500000, end: 1200000, hl: [4, 8] },
    ],
    trackName: "subtitle",
    highlightSize: 24,
  });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const matOf = (i) => draft.materials.texts.find((m) => m.id === track.segments[i].material_id);
  strictEqual(styles(matOf(0).content)[1].size, 30, "per-card hlSize wins");
  strictEqual(styles(matOf(1).content)[1].size, 24, "global highlightSize is the fallback");
});

test("add-text --keyword-size (CLI): emphasis span carries the size, base span keeps --font-size", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli([
    "add-text", filePath, "0", "2s", "DANGER zone",
    "--keyword", "DANGER", "--keyword-size", "28", "--font-size", "15",
  ]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const s = styles(lastTextMaterial(filePath, r.json.material_id).content);
  strictEqual(s[0].size, 28, "keyword span (DANGER at [0,6]) gets --keyword-size");
  strictEqual(s[1].size, 15, "rest of the caption keeps --font-size");
});

test("import-captions --highlight-size (CLI): global size applied; per-card hlSize still wins", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "size-cards.json");
  writeFileSync(
    jsonPath,
    JSON.stringify([
      { text: "le PC", start: 0, end: 500000, hl: [3, 5], hlSize: 30 },
      { text: "est mort", start: 500000, end: 1200000, hl: [4, 8] },
    ]),
    "utf-8",
  );
  const r = runCli(["import-captions", filePath, jsonPath, "--highlight-size", "28", "--track-name", "subtitle"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const track = after.tracks.find((tr) => tr.id === r.json.track_id);
  const matOf = (i) => after.materials.texts.find((m) => m.id === track.segments[i].material_id);
  strictEqual(styles(matOf(0).content)[1].size, 30, "per-card hlSize beats the global flag");
  strictEqual(styles(matOf(1).content)[1].size, 28, "--highlight-size is the global default");
});

test("--keyword-size / --highlight-size (CLI): NaN or <= 0 rejected", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r1 = runCli(["add-text", filePath, "0", "2s", "DANGER zone", "--keyword", "DANGER", "--keyword-size", "0"]);
  strictEqual(r1.status, 1);
  ok(r1.errorJson, `expected JSON on stderr, got: ${r1.stderr}`);
  match(r1.errorJson.error, /--keyword-size/);
  const r2 = runCli(["import-captions", filePath, "whatever.json", "--highlight-size", "abc"]);
  strictEqual(r2.status, 1);
  ok(r2.errorJson, `expected JSON on stderr, got: ${r2.stderr}`);
  match(r2.errorJson.error, /--highlight-size/);
});

test("import-captions (CLI): invalid per-card hlSize rejected (string / zero) — no silent draft corruption", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "bad-size.json");
  writeFileSync(
    jsonPath,
    JSON.stringify([{ text: "le PC", start: 0, end: 500000, hl: [3, 5], hlSize: "big" }]),
    "utf-8",
  );
  const r1 = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle"]);
  strictEqual(r1.status, 1);
  ok(r1.errorJson, `expected JSON on stderr, got: ${r1.stderr}`);
  match(r1.errorJson.error, /captions\[0\].*hlSize/);
  writeFileSync(jsonPath, JSON.stringify([{ text: "le PC", start: 0, end: 500000, hl: [3, 5], hlSize: 0 }]), "utf-8");
  const r2 = runCli(["import-captions", filePath, jsonPath, "--track-name", "subtitle"]);
  strictEqual(r2.status, 1);
  ok(r2.errorJson, `expected JSON on stderr, got: ${r2.stderr}`);
  match(r2.errorJson.error, /captions\[0\].*hlSize/);
});

test("add-text --keyword-range + --keyword-size (CLI): explicit range span carries the size", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", filePath, "0", "2s", "alpha bravo", "--keyword-range", "6,11", "--keyword-size", "28"]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const s = styles(lastTextMaterial(filePath, r.json.material_id).content);
  deepStrictEqual(s.map((x) => x.range), [
    [0, 6],
    [6, 11],
  ]);
  strictEqual(s[0].size, 15, "base span keeps the default fontSize");
  strictEqual(s[1].size, 28, "range-selected span carries --keyword-size");
});

test("importCaptions --clone-style + hlSize: size override rides ON the cloned style block", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const track = draft.tracks.find((tr) => tr.type === "text");
  const tplMat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  tplMat.content = JSON.stringify({ text: "modèle", styles: [FAKE_STYLE] });
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "le PC", start: 0, end: 500000, hl: [3, 5], hlSize: 34 }],
    cloneStyle: true,
  });
  const newTrack = draft.tracks.find((tr) => tr.id === res.trackId);
  const mat = draft.materials.texts.find((m) => m.id === newTrack.segments[0].material_id);
  const s = styles(mat.content);
  strictEqual(s[0].size, 22, "base span keeps the cloned size");
  strictEqual(s[1].size, 34, "emphasis span: hlSize overrides the cloned size");
  deepStrictEqual(s[1].font, FAKE_STYLE.font, "cloned font survives next to the size override");
});

test("importCaptions: hlSize without hl is silently ignored (single span, not rich)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "no keyword", start: 0, end: 1000000, hlSize: 34 }],
    trackName: "subtitle",
  });
  const track = draft.tracks.find((tr) => tr.id === res.trackId);
  const mat = draft.materials.texts.find((m) => m.id === track.segments[0].material_id);
  strictEqual("is_rich_text" in mat, false, "no hl → no rich text, hlSize alone changes nothing");
  strictEqual(styles(mat.content).length, 1);
});

test("importCaptions: without --track-name targets the FIRST existing text track (no duplicate track)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const textTracksBefore = draft.tracks.filter((tr) => tr.type === "text");
  const firstTextTrack = textTracksBefore[0];
  const res = importCaptions(draft, filePath, {
    cards: [{ text: "one", start: 0, end: 1000000 }],
    // no trackName
  });
  strictEqual(res.trackId, firstTextTrack.id, "replaces the existing first text track");
  strictEqual(
    draft.tracks.filter((tr) => tr.type === "text").length,
    textTracksBefore.length,
    "must NOT create an extra text track",
  );
});
