declare module "fontkit" {
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }

  export interface GlyphRun {
    positions: GlyphPosition[];
  }

  export interface Font {
    unitsPerEm: number;
    layout(text: string): GlyphRun;
  }

  export function openSync(filename: string, postscriptName?: string): Font;
}
