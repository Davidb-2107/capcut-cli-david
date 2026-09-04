import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { openSync } from "fontkit";

import { clearFontMetricsCache, fontMetrics, measureTextWidthPx } from "../dist/utils/font-metrics.js";

const fontPath = join(process.cwd(), "test-fixtures", "fonts", "Rubik-Bold.ttf");
const style = { fontPath, capcutFontSize: 20, letterSpacing: 0 };

test.beforeEach(() => clearFontMetricsCache());

test("measures a readable TTF through OpenType layout", () => {
  const width = measureTextWidthPx("AV fi office é", style);
  ok(width > 0);
});

test("empty text has zero width and size scales proportionally", () => {
  strictEqual(measureTextWidthPx("", style), 0);
  const small = measureTextWidthPx("Cascade", { ...style, capcutFontSize: 10 });
  const large = measureTextWidthPx("Cascade", { ...style, capcutFontSize: 20 });
  strictEqual(large, small * 2);
});

test("applies the explicit CapCut calibration scale after OpenType measurement", () => {
  const openTypeWidth = measureTextWidthPx("dix secondes de trop", style);
  const capcutWidth = measureTextWidthPx("dix secondes de trop", { ...style, capcutScale: 5.200473 });

  strictEqual(capcutWidth, openTypeWidth * 5.200473);
});

test("same path can be measured repeatedly through the cache", () => {
  const first = fontMetrics.measure("AV", style);
  const second = fontMetrics.measure("AV", style);
  strictEqual(first, second);
});

test("ignores pair kerning while preserving shaped glyph substitutions", () => {
  const font = openSync(fontPath);
  const run = font.layout("AV");
  const unkernedAdvance = run.glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
  const expected = (unkernedAdvance / font.unitsPerEm) * style.capcutFontSize;

  strictEqual(measureTextWidthPx("AV", style), expected);
});

test("layout shaping is used for ligatures rather than independent word sums", () => {
  const pair = measureTextWidthPx("fi", style);
  const independent = measureTextWidthPx("f", style) + measureTextWidthPx("i", style);
  ok(pair !== independent, `expected shaping to differ: pair=${pair}, independent=${independent}`);
});

test("non-zero letter spacing is rejected until CapCut calibration exists", () => {
  throws(() => measureTextWidthPx("word", { ...style, letterSpacing: 1 }), /calibration/i);
});

test("missing and malformed font files produce path-specific errors", () => {
  throws(() => measureTextWidthPx("word", { ...style, fontPath: join(process.cwd(), "missing.ttf") }), /not readable:.*missing\.ttf/i);
  throws(() => measureTextWidthPx("word", { ...style, fontPath: join(process.cwd(), "test-fixtures", "fonts", "OFL.txt") }), /parse.*OFL\.txt/i);
});

test("FontMetrics exposes the same measurement contract", () => {
  deepStrictEqual(fontMetrics.measure("word", style), measureTextWidthPx("word", style));
});
