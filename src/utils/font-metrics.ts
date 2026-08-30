import { existsSync, realpathSync, statSync } from "node:fs";
import { openSync, type Font } from "fontkit";

export interface FontMeasureStyle {
  fontPath: string;
  capcutFontSize: number;
  letterSpacing: number;
}

export interface FontMetrics {
  measure(text: string, style: FontMeasureStyle): number;
}

const fontCache = new Map<string, Font>();

function readableFontPath(fontPath: string): string {
  try {
    if (!existsSync(fontPath) || !statSync(fontPath).isFile()) {
      throw new Error("not a regular file");
    }
    return realpathSync(fontPath);
  } catch (error) {
    throw new Error(`Font file is not readable: ${fontPath} (${(error as Error).message})`);
  }
}

function loadFont(fontPath: string): Font {
  const canonicalPath = readableFontPath(fontPath);
  const cached = fontCache.get(canonicalPath);
  if (cached) return cached;
  try {
    const font = openSync(canonicalPath);
    fontCache.set(canonicalPath, font);
    return font;
  } catch (error) {
    throw new Error(`Unable to parse font file ${fontPath}: ${(error as Error).message}`);
  }
}

function validateStyle(style: FontMeasureStyle): void {
  if (!Number.isFinite(style.capcutFontSize) || style.capcutFontSize <= 0) {
    throw new Error(`Font size must be a positive finite number, got ${style.capcutFontSize}.`);
  }
  if (!Number.isFinite(style.letterSpacing)) {
    throw new Error(`Letter spacing must be finite, got ${style.letterSpacing}.`);
  }
  // The CapCut letter-spacing conversion is deliberately gated on the real
  // calibration probe. Until that probe is available, silently applying a
  // guessed conversion would make layout and rendering disagree.
  if (style.letterSpacing !== 0) {
    throw new Error("Non-zero letterSpacing requires a measured CapCut calibration.");
  }
}

export function measureTextWidthPx(
  fontPath: string,
  text: string,
  capcutFontSize: number,
  letterSpacing?: number,
): number;
export function measureTextWidthPx(text: string, style: FontMeasureStyle): number;
export function measureTextWidthPx(
  first: string,
  second: string | FontMeasureStyle,
  capcutFontSize?: number,
  letterSpacing = 0,
): number {
  const text = typeof second === "string" ? second : first;
  const style: FontMeasureStyle =
    typeof second === "string"
      ? { fontPath: first, capcutFontSize: capcutFontSize as number, letterSpacing }
      : second;
  if (typeof text !== "string") throw new Error("Text to measure must be a string.");
  validateStyle(style);
  if (text.length === 0) return 0;

  const font = loadFont(style.fontPath);
  const run = font.layout(text);
  const advanceUnits = run.positions.reduce((sum, position) => sum + position.xAdvance, 0);
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    throw new Error(`Font ${style.fontPath} has invalid unitsPerEm: ${font.unitsPerEm}.`);
  }
  // This is the canonical OpenType em-to-size conversion. The pending CapCut
  // probe may later document an additional engine scale, but no empirical
  // factor is introduced until that value is measured and recorded.
  return (advanceUnits / font.unitsPerEm) * style.capcutFontSize;
}

export const fontMetrics: FontMetrics = {
  measure: measureTextWidthPx,
};

export function clearFontMetricsCache(): void {
  fontCache.clear();
}
