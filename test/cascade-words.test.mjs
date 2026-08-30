// Tests for cascade-words (src/commands/cascade-words.ts → dist).
// Karaoke build-up: per line, a readable BASE track (full line text) plus one WORD
// track per word (highlight color, x-offset to sit over its matching word in the
// base), staggered starts, each ending when the line ends.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, match } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { addText } from "../dist/commands/create.js";
import { cascadeWords } from "../dist/commands/cascade-words.js";
import { loadDraft, saveDraft } from "../dist/draft.js";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const WORDS = [
  { text: "this", start: 0, end: 200000 },
  { text: "is", start: 200000, end: 400000 },
  { text: "the", start: 400000, end: 700000 },
  { text: "second", start: 700000, end: 1100000 },
];
const GUIDE_END = 2000000; // padded guide segment — always > WORDS' natural end
const LAST_END = WORDS[WORDS.length - 1].end; // 1100000 — last card's own end (guideEnd padding must NOT extend past this)
const WHITE = [1, 1, 1];
const YELLOW = [1, 0.8392156862745098, 0]; // #FFD600 float32
const MEASURED_FONT = {
  title: "Measured Font",
  resourceId: "font-rid",
  fontPath: "C:/fonts/measured.ttf",
  source: "catalogue",
};

function withFont(opts) {
  return { ...opts, font: MEASURED_FONT };
}

function buildGuide(draft, filePath) {
  addText(draft, filePath, { text: "this is the second type of text", start: 0, duration: GUIDE_END, trackName: "sentence" });
  return draft.tracks.find((t) => t.type === "text" && t.name === "sentence");
}

function styles(content) {
  return JSON.parse(content).styles;
}

function materialForTrack(draft, trackId) {
  const tr = draft.tracks.find((t) => t.id === trackId);
  return draft.materials.texts.find((m) => m.id === tr.segments[0].material_id);
}

function setGuideStyle(draft, guide, filePath, overrides = {}) {
  const fontPath = join(dirname(filePath), "Fake.ttf");
  writeFileSync(fontPath, "font fixture");
  const tplMat = draft.materials.texts.find((m) => m.id === guide.segments[0].material_id);
  tplMat.font_path = fontPath;
  tplMat.font_id = "fake";
  tplMat.font_title = "Fake";
  tplMat.font_resource_id = "fake-rid";
  tplMat.font_source_platform = 1;
  tplMat.fonts = [{ title: "Fake", path: fontPath, resource_id: "fake-rid", source_platform: 1 }];
  tplMat.content = JSON.stringify({
    text: "modele",
    styles: [{ font: { path: fontPath, id: "fake" }, size: 22, range: [0, 6], ...(overrides.style ?? {}) }],
  });
  Object.assign(tplMat, overrides.material ?? {});
  return { tplMat, fontPath };
}

function assertTextFontConsistency(mat, expected) {
  const style = JSON.parse(mat.content).styles[0];
  strictEqual(style.font.path, expected.path);
  strictEqual(mat.font_path, expected.path);
  strictEqual(style.size, expected.size);
  strictEqual(mat.font_size, expected.size);
  strictEqual(mat.letter_spacing ?? 0, 0);
  if (expected.id !== undefined) {
    strictEqual(style.font.id, expected.id);
    strictEqual(mat.font_id, expected.id);
  }
}

function makeFontLibrary(filePath) {
  const root = join(dirname(filePath), "drafts");
  const witness = join(root, "font-witness");
  const fontPath = join(dirname(filePath), "Measured.ttf");
  mkdirSync(witness, { recursive: true });
  writeFileSync(fontPath, "font fixture");
  writeFileSync(
    join(witness, "draft_content.json"),
    JSON.stringify({
      materials: {
        texts: [
          {
            font_path: fontPath,
            font_resource_id: "font-rid",
            font_source_platform: 1,
            fonts: [{ title: "Measured Font", path: fontPath, resource_id: "font-rid", source_platform: 1 }],
          },
        ],
      },
    }),
  );
  return { root, fontPath };
}

test("cascadeWords: single line (no --max-chars) — one base track + N word tracks", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);

  const res = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
  strictEqual(res.wordCount, 4);
  strictEqual(res.lineCount, 1);
  strictEqual(res.trackIds.length, 5); // 1 base + 4 words

  const base = draft.tracks.find((tr) => tr.name === "line-000");
  ok(base, "base track created");
  const mat = draft.materials.texts.find((m) => m.id === base.segments[0].material_id);
  strictEqual(JSON.parse(mat.content).text, "this is the second");
  deepStrictEqual(styles(mat.content)[0].fill.content.solid.color, WHITE);
  ok(base.attribute & 2, "base track's hidden bit set — this is what CapCut's eye icon actually reads");
  strictEqual(
    base.segments[0].visible,
    true,
    "segment.visible is left at its default (true) — cascade-words never sets it false, since that sticks even after the eye toggle is clicked back on",
  );
  strictEqual(base.segments[0].target_timerange.start, 0);
  strictEqual(
    base.segments[0].target_timerange.start + base.segments[0].target_timerange.duration,
    LAST_END,
    "single line's base ends at the last word's own natural end, not the padded guide end",
  );

  const wordTracks = draft.tracks.filter((tr) => tr.name?.startsWith("word-"));
  strictEqual(wordTracks.length, 4);
});

test("cascadeWords: word tracks are highlight-colored and end at the line end", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));

  WORDS.forEach((card, i) => {
    const tr = draft.tracks.find((t2) => t2.name === `word-${String(i).padStart(3, "0")}`);
    strictEqual(tr.segments.length, 1);
    const seg = tr.segments[0];
    const mat = draft.materials.texts.find((m) => m.id === seg.material_id);
    deepStrictEqual(styles(mat.content)[0].fill.content.solid.color, YELLOW);
    strictEqual(seg.target_timerange.start, card.start);
    strictEqual(seg.target_timerange.start + seg.target_timerange.duration, LAST_END);
  });
});

test("cascadeWords: word x-offset sign matches position in line (before/after center)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));

  // line text = "this is the second" (19 chars), midpoint ~9.5.
  // "this" (chars 0-4, mid 2) sits left of center -> negative x.
  // "second" (chars 13-19, mid 16) sits right of center -> positive x.
  const xOf = (name) => draft.tracks.find((tr) => tr.name === name).segments[0].clip.transform.x;
  ok(xOf("word-000") < 0, "this (early in line) should offset left (negative x)");
  ok(xOf("word-003") > 0, "second (late in line) should offset right (positive x)");
  strictEqual(typeof xOf("word-001"), "number");
});

test("cascadeWords: base track pushed before its line's word tracks (z-order)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));

  const baseIdx = draft.tracks.findIndex((tr) => tr.name === "line-000");
  const wordIdx = ["word-000", "word-001", "word-002", "word-003"].map((name) =>
    draft.tracks.findIndex((tr) => tr.name === name),
  );
  for (const w of wordIdx) ok(w > baseIdx, `word track ${w} must be pushed after base track ${baseIdx}`);
});

test("cascadeWords --max-chars: splits into multiple lines, each with its own base + words", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  // "this is the" = 11 chars (fits <=12); adding "second" would make 18 -> overflows.
  const res = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence", maxChars: 12 }));
  strictEqual(res.lineCount, 2);
  strictEqual(res.wordCount, 4);

  const line0 = draft.tracks.find((tr) => tr.name === "line-000");
  const line1 = draft.tracks.find((tr) => tr.name === "line-001");
  const matOf = (tr) => draft.materials.texts.find((m) => m.id === tr.segments[0].material_id);
  strictEqual(JSON.parse(matOf(line0).content).text, "this is the");
  strictEqual(JSON.parse(matOf(line1).content).text, "second");

  const end = (tr) => tr.segments[0].target_timerange.start + tr.segments[0].target_timerange.duration;
  strictEqual(end(line0), WORDS[3].start, "line 1 base ends when line 2 starts");
  strictEqual(end(line1), LAST_END, "last line's base ends at its own last word's natural end, not guideEnd");

  const wend = (name) => {
    const tr = draft.tracks.find((t2) => t2.name === name);
    return tr.segments[0].target_timerange.start + tr.segments[0].target_timerange.duration;
  };
  strictEqual(wend("word-000"), WORDS[3].start);
  strictEqual(wend("word-002"), WORDS[3].start);
  strictEqual(wend("word-003"), LAST_END);
});

test("cascadeWords: last line's end is capped at guideEnd when the guide is SHORTER than the last card", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  // Guide segment shorter than the last card's own natural end (900000 < 1100000).
  addText(draft, filePath, { text: "short guide", start: 0, duration: 900000, trackName: "sentence" });
  const res = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
  const line0 = draft.tracks.find((tr) => tr.id === res.trackIds[0]);
  strictEqual(
    line0.segments[0].target_timerange.start + line0.segments[0].target_timerange.duration,
    900000,
    "never exceeds the guide's own bound, even though the last card's natural end is later",
  );
});

test("cascadeWords: guide track is hidden via attribute (not segment.visible), segment marked consumed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath);
  const before = { ...guide.segments[0], cascade_words_consumed: undefined };
  cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
  const guideTrackAfter = draft.tracks.find((t2) => t2.id === guide.id);
  const after = guideTrackAfter.segments[0];
  strictEqual(after.visible, true, "segment.visible untouched — sticks if set, so cascade-words never sets it");
  strictEqual(after.cascade_words_consumed, true, "consumed marker set (bookkeeping only, not a CapCut-meaningful field)");
  strictEqual(
    JSON.stringify({ ...after, cascade_words_consumed: undefined }),
    JSON.stringify(before),
    "all other fields unchanged",
  );
  ok(guideTrackAfter.attribute & 2, "guide track's hidden bit set — this is what CapCut's eye icon actually reads");
});

test("cascadeWords: guide track with multiple segments — each call anchors to and hides its OWN (first unconsumed) one", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath); // segment 0: [0, GUIDE_END)
  const SECOND_START = GUIDE_END;
  const SECOND_END = GUIDE_END + 500000;
  addText(draft, filePath, {
    text: "second sentence",
    start: SECOND_START,
    duration: SECOND_END - SECOND_START,
    trackName: "sentence",
  }); // segment 1
  strictEqual(guide.segments.length, 2);

  // Call 1: consumes segment 0 (still-unconsumed-by-default first one).
  const res1 = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
  strictEqual(guide.segments[0].cascade_words_consumed, true, "segment 0 consumed");
  strictEqual(guide.segments[1].cascade_words_consumed, undefined, "segment 1 untouched — not this call's guide");
  ok(guide.attribute & 2, "whole guide track already hidden after call 1 (guide is never meant to be shown at all)");
  const line0 = draft.tracks.find((tr) => tr.id === res1.trackIds[0]);
  strictEqual(
    line0.segments[0].target_timerange.start + line0.segments[0].target_timerange.duration,
    LAST_END,
    "last line of call 1 ends at its own last word's natural end (capped by segment 0, not stretched to fill it)",
  );

  // Call 2: segment 0 already consumed -> must pick segment 1 as its guide.
  const secondWordEnd = SECOND_START + 100000;
  const secondWords = [{ text: "hi", start: SECOND_START, end: secondWordEnd }];
  const res2 = cascadeWords(draft, filePath, withFont({
    cards: secondWords,
    guideTrackName: "sentence",
    trackPrefix: "word2",
    linePrefix: "line2",
  }));
  strictEqual(guide.segments[1].cascade_words_consumed, true, "segment 1 now consumed too");
  const line2 = draft.tracks.find((tr) => tr.id === res2.trackIds[0]);
  strictEqual(
    line2.segments[0].target_timerange.start + line2.segments[0].target_timerange.duration,
    secondWordEnd,
    "call 2's last line ends at its own last word's natural end, well before segment 1's padded end",
  );
  ok(secondWordEnd < SECOND_END, "sanity: the natural end really is earlier than the guide's padded end");
});

test("cascadeWords: word starting at/after line end is skipped, not counted", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  const cards = [...WORDS, { text: "late", start: GUIDE_END, end: GUIDE_END + 100000 }];
  const res = cascadeWords(draft, filePath, withFont({ cards, guideTrackName: "sentence" }));
  strictEqual(res.wordCount, 4, "the out-of-range 5th card produces no word track");
  strictEqual(draft.tracks.find((tr) => tr.name === "word-004"), undefined);
});

test("cascadeWords: empty cards array dies", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  try {
    cascadeWords(draft, filePath, withFont({ cards: [], guideTrackName: "sentence" }));
    ok(false, "should have thrown");
  } catch (e) {
    match(e.message, /non-empty array/);
  }
});

test("cascadeWords: missing guide track dies", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  try {
    cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "nope" }));
    ok(false, "should have thrown");
  } catch (e) {
    match(e.message, /guide track "nope" not found/);
  }
});

test("cascadeWords: --track-prefix collision with an existing track dies", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  draft.tracks.push({ id: "x", type: "text", name: "word-000", attribute: 0, segments: [] });
  try {
    cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
    ok(false, "should have thrown");
  } catch (e) {
    match(e.message, /collides with existing track/);
  }
});

test("cascadeWords: --line-prefix collision with an existing track dies", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  draft.tracks.push({ id: "x", type: "text", name: "line-000", attribute: 0, segments: [] });
  try {
    cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence" }));
    ok(false, "should have thrown");
  } catch (e) {
    match(e.message, /--line-prefix "line" collides/);
  }
});

test("cascadeWords --clone-style: base and word segments inherit the guide caption's style", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath);
  const { fontPath } = setGuideStyle(draft, guide, filePath);

  const res = cascadeWords(draft, filePath, { cards: WORDS, guideTrackName: "sentence", cloneStyle: true });
  for (const id of res.trackIds) {
    const tr = draft.tracks.find((t2) => t2.id === id);
    const mat = draft.materials.texts.find((m) => m.id === tr.segments[0].material_id);
    strictEqual(mat.is_rich_text, true);
    const style = JSON.parse(mat.content).styles[0];
    deepStrictEqual(style.font, { path: fontPath, id: "fake" });
    strictEqual(style.size, 22);
  }
});

test("cascadeWords --font without --clone-style: generated materials bind the measured font consistently", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);

  const res = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence", fontSize: 24 }));
  for (const id of res.trackIds) {
    assertTextFontConsistency(materialForTrack(draft, id), { path: MEASURED_FONT.fontPath, id: "font-rid", size: 24 });
  }
});

test("cascadeWords --clone-style: cloned materials keep font path/id and size mirrors consistent", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath);
  const { fontPath } = setGuideStyle(draft, guide, filePath);

  const res = cascadeWords(draft, filePath, { cards: WORDS, guideTrackName: "sentence", cloneStyle: true });
  for (const id of res.trackIds) {
    assertTextFontConsistency(materialForTrack(draft, id), { path: fontPath, id: "fake", size: 22 });
  }
});

test("cascadeWords --font + --clone-style: explicit font replaces cloned font while preserving cloned size", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath);
  setGuideStyle(draft, guide, filePath);

  const res = cascadeWords(draft, filePath, withFont({ cards: WORDS, guideTrackName: "sentence", cloneStyle: true }));
  for (const id of res.trackIds) {
    assertTextFontConsistency(materialForTrack(draft, id), { path: MEASURED_FONT.fontPath, id: "font-rid", size: 22 });
  }
});

test("cascadeWords: without --font or readable --clone-style dies before mutation", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  const guide = buildGuide(draft, filePath);
  const tracksBefore = draft.tracks.length;
  const textsBefore = draft.materials.texts.length;

  try {
    cascadeWords(draft, filePath, { cards: WORDS, guideTrackName: "sentence" });
    ok(false, "should have thrown");
  } catch (e) {
    match(e.message, /--font.*--clone-style|required/);
  }
  strictEqual(draft.tracks.length, tracksBefore);
  strictEqual(draft.materials.texts.length, textsBefore);
  strictEqual(guide.segments[0].cascade_words_consumed, undefined);
});

test("cascadeWords --clone-style: refuses unvalidated horizontal/non-linear styles before mutation", (t) => {
  const cases = [
    { material: { letter_spacing: 1 }, message: /letter_spacing/ },
    { material: { fixed_width: 120 }, message: /fixed_width\/fixed_height/ },
    { style: { text_curve: 1 }, message: /text_curve/ },
  ];

  for (const c of cases) {
    const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
    const { draft } = loadDraft(filePath);
    const guide = buildGuide(draft, filePath);
    setGuideStyle(draft, guide, filePath, c);
    const tracksBefore = draft.tracks.length;
    const textsBefore = draft.materials.texts.length;

    try {
      cascadeWords(draft, filePath, { cards: WORDS, guideTrackName: "sentence", cloneStyle: true });
      ok(false, "should have thrown");
    } catch (e) {
      match(e.message, c.message);
    }
    strictEqual(draft.tracks.length, tracksBefore);
    strictEqual(draft.materials.texts.length, textsBefore);
    strictEqual(guide.segments[0].cascade_words_consumed, undefined);
  }
});

test("cascade-words (CLI happy): reads JSON, creates base+word tracks, returns counts", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  saveDraft(filePath, draft);

  const jsonPath = join(dirname(filePath), "words.json");
  writeFileSync(jsonPath, JSON.stringify(WORDS), "utf-8");
  const { root } = makeFontLibrary(filePath);
  const r = runCli(["cascade-words", filePath, jsonPath, "--guide-track", "sentence", "--font", "Measured", "--drafts", root]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  strictEqual(r.json.ok, true);
  strictEqual(r.json.word_count, 4);
  strictEqual(r.json.line_count, 1);
  strictEqual(r.json.track_ids.length, 5);

  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  ok(after.tracks.some((tr) => tr.name === "line-000"));
  strictEqual(after.tracks.filter((tr) => tr.name?.startsWith("word-")).length, 4);
});

test("cascade-words (CLI): missing --guide-track dies", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft } = loadDraft(filePath);
  buildGuide(draft, filePath);
  saveDraft(filePath, draft);

  const jsonPath = join(dirname(filePath), "words.json");
  writeFileSync(jsonPath, JSON.stringify(WORDS), "utf-8");
  const r = runCli(["cascade-words", filePath, jsonPath]);
  strictEqual(r.status, 1);
  ok(r.errorJson, `expected JSON on stderr, got: ${r.stderr}`);
  match(r.errorJson.error, /--guide-track/);
});
