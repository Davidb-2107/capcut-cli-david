declare module "fontkit" {
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }

  export interface Glyph {
    advanceWidth: number;
  }

  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }

  export interface Font {
    unitsPerEm: number;
    layout(text: string): GlyphRun;
  }

  export function openSync(filename: string, postscriptName?: string): Font;
}
