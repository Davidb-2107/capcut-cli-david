import { existsSync, readFileSync } from "node:fs";
import { type Draft, type Segment, saveDraft, type Track } from "../draft.js";
import { die, type Flags, out } from "../utils/cli.js";
import { baseSegment, createCompanionMaterials, hexToRgb, registerCompanions, uuid } from "../utils/companion.js";
import {
  applyTextFontIdentity,
  buildRichTextContent,
  buildTextMaterial,
  type CaptionCard,
  DEFAULT_HIGHLIGHT_COLOR,
  resolveCloneStyle,
  type TextFontIdentity,
} from "./create.js";
import { resolveFontReference, type ResolvedFont } from "../utils/font-resolver.js";

// --- Cascade words (word-by-word sentence build-up, not karaoke) ---
//
// Reveals a sentence one word at a time, each word staying on screen once it appears,
// until the full sentence is shown — NOT karaoke (one word lit at a time). Given a
// "guide" text track that already holds the full-sentence caption (created via
// import-captions) and word-level timing from Shared/narration-alignment's --karaoke
// mode (one {text,start,end} card per spoken word, microseconds), groups words into
// lines (--max-chars heuristic, or one line if omitted) and per line:
//   1. a BASE track (full line text, base color, centered) spanning the line's whole
//      time window — a PLACEMENT GUIDE only, hidden immediately (visible=false): it
//      exists purely to line up the highlight words into a coherent sentence, never
//      meant to be seen;
//   2. one WORD track per word (highlight color, the only thing actually visible),
//      staggered starts (its own spoken time), each ending when the line ends,
//      x-offset to visually sit over its matching word in the base guide (char-count
//      heuristic, not real font metrics — see CHAR_WIDTH_FACTOR). Pushed AFTER the
//      base track (track order convention only — base is invisible either way).
// A line's own end is the next line's first word start (or the guide segment's end for the
// last line) — so a line's build-up freezes/vanishes exactly when the next line begins.
// The guide track is hidden via its track.attribute bit (not deleted, and not via
// segment.visible — see the selection comment below) — otherwise its full sentence(s)
// would render for the whole clip, on top of the cascade. A guide track can hold
// several sentence segments (repeated calls, one per sentence): each call picks the
// first not-yet-consumed one as its own guide (tracked with a private marker, not
// visibility), so a run of calls consumes them one at a time.

export interface CascadeWordsOptions {
  cards: CaptionCard[];
  guideTrackName: string;
  trackPrefix?: string;
  linePrefix?: string;
  fontSize?: number;
  /** Base (hidden placement-guide line) text color. Default #FFFFFF. Invisible either
   * way (visible=false) — kept configurable only in case its width estimate should
   * ever differ by color-dependent rendering quirks; the highlight color is what
   * actually shows on screen. */
  color?: string;
  /** Word-overlay highlight color. Default DEFAULT_HIGHLIGHT_COLOR (#FFD600). */
  highlightColor?: string;
  alignment?: number;
  cloneStyle?: boolean;
  font?: ResolvedFont;
  /** Char-count-per-line heuristic (same proxy as caption_builder.py's phrase-mode
   * max_chars — not pixel-exact, but production-proven for "stays on one line").
   * When the cumulative "word word word" text of the current line would exceed this,
   * the next word starts a NEW line. Omit for a single line (still gets a base track). */
  maxChars?: number;
}

export interface EffectiveTextStyle {
  fontPath: string;
  fontId: string;
  fontTitle: string;
  fontSize: number;
  letterSpacing: number;
  clonedStyle?: Record<string, unknown>;
}

// ponytail: empirical fit vs David's hand-placed demo draft (font_size 20 @ 1920px
// canvas, cascade-words-demo-16x9) — not real glyph metrics. Revisit per-font once
// fonts are catalogued with real width data (parked, same call as the earlier
// "measure pixel width for one-line fit" deferral).
const CHAR_WIDTH_FACTOR = 4.4;

function padWidth(n: number): number {
  return Math.max(3, String(Math.max(0, n - 1)).length);
}

/** Assigns each card a 0-based line index by greedily packing cumulative text
 * length ("word word word") under maxChars. A single word longer than maxChars
 * still starts its own line alone (can't split mid-word). */
function groupLines(cards: CaptionCard[], maxChars: number): number[] {
  const lineOf: number[] = [];
  let line = 0;
  let len = 0;
  for (const card of cards) {
    const wordLen = card.text.length;
    const candidate = len === 0 ? wordLen : len + 1 + wordLen;
    if (len > 0 && candidate > maxChars) {
      line++;
      len = wordLen;
    } else {
      len = candidate;
    }
    lineOf.push(line);
  }
  return lineOf;
}

/** Each line's [start, end) window: start = its first word's own start; end = the next
 * line's first word start, or — for the last line — its own last card's natural end
 * (never the guide segment's end verbatim: the guide is often padded/longer than the
 * actual speech, and stretching the last word to fill that dead air displays it "for
 * no reason" after the sentence is already fully spoken). Capped at guideEnd so the
 * last line never outruns the guide's own bound either way. */
function computeLineBounds(
  cards: CaptionCard[],
  lineOf: number[],
  guideEnd: number,
): { starts: number[]; ends: number[] } {
  const numLines = lineOf.length > 0 ? lineOf[lineOf.length - 1] + 1 : 0;
  const lastLineEnd = cards.length > 0 ? Math.min(guideEnd, cards[cards.length - 1].end) : guideEnd;
  const starts = new Array<number>(numLines).fill(0);
  const ends = new Array<number>(numLines).fill(lastLineEnd);
  for (let i = 0; i < cards.length; i++) {
    if (i === 0 || lineOf[i] !== lineOf[i - 1]) starts[lineOf[i]] = cards[i].start;
    if (i > 0 && lineOf[i] !== lineOf[i - 1]) ends[lineOf[i - 1]] = cards[i].start;
  }
  return { starts, ends };
}

/** Per line, the concatenated "word word word" text, plus each card's [charStart, charEnd)
 * range within its line's text (single-space joins) — used for the x-offset heuristic. */
function buildLineTexts(
  cards: CaptionCard[],
  lineOf: number[],
): { lineTexts: string[]; charRanges: Array<[number, number]> } {
  const numLines = lineOf.length > 0 ? lineOf[lineOf.length - 1] + 1 : 0;
  const lineTexts = new Array<string>(numLines).fill("");
  const charRanges = new Array<[number, number]>(cards.length);
  let pos = 0;
  cards.forEach((card, i) => {
    if (i === 0 || lineOf[i] !== lineOf[i - 1]) pos = 0;
    if (pos > 0) {
      lineTexts[lineOf[i]] += " ";
      pos += 1;
    }
    const start = pos;
    lineTexts[lineOf[i]] += card.text;
    pos += card.text.length;
    charRanges[i] = [start, pos];
  });
  return { lineTexts, charRanges };
}

function checkPrefixCollision(draft: Draft, prefix: string, flagName: string): void {
  const collisions = draft.tracks
    .map((t) => t.name)
    .filter((name): name is string => typeof name === "string" && new RegExp(`^${prefix}-\\d+$`).test(name));
  if (collisions.length > 0) {
    die(
      `cascade-words: ${flagName} "${prefix}" collides with existing track(s): ${collisions.join(", ")}. Pick a different ${flagName} or remove them first.`,
    );
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function firstFontEntry(material: Record<string, unknown>): Record<string, unknown> | undefined {
  return Array.isArray(material.fonts) && material.fonts[0] && typeof material.fonts[0] === "object"
    ? (material.fonts[0] as Record<string, unknown>)
    : undefined;
}

function ensureCloneIsMeasurable(
  cloneTpl: { styleBlock: Record<string, unknown>; material: Record<string, unknown> },
  guideTrackName: string,
): void {
  const material = cloneTpl.material;
  const styleBlock = cloneTpl.styleBlock;
  const letterSpacing = num(material.letter_spacing) ?? 0;
  if (letterSpacing !== 0) {
    die("cascade-words: cloned styles with non-zero letter_spacing are not supported yet");
  }
  const textCurve = material.text_curve ?? styleBlock.text_curve;
  if (textCurve !== undefined && textCurve !== null && textCurve !== 0) {
    die("cascade-words: cloned style uses text_curve; cascade-words requires measurable linear text");
  }
  if ((num(material.fixed_width) ?? -1) > 0 || (num(material.fixed_height) ?? -1) > 0) {
    die("cascade-words: cloned style uses fixed_width/fixed_height; cascade-words requires measurable linear text");
  }

  const font = styleBlock.font;
  const fontPath = font && typeof font === "object" ? str((font as Record<string, unknown>).path) : undefined;
  if (!fontPath || !existsSync(fontPath)) {
    die(`cascade-words: --clone-style requires a readable content.styles[0].font.path on guide track "${guideTrackName}"`);
  }
}

function fontIdentityFromResolved(font: ResolvedFont): TextFontIdentity {
  return {
    path: font.fontPath,
    id: font.resourceId ?? "",
    title: font.title,
    resourceId: font.resourceId,
    sourcePlatform: font.resourceId ? 1 : 0,
    fontsEntry: {
      title: font.title,
      path: font.fontPath,
      id: font.resourceId ?? "",
      resource_id: font.resourceId ?? "",
      source_platform: font.resourceId ? 1 : 0,
      effect_id: font.resourceId ?? "",
      request_id: "",
    },
  };
}

function fontIdentityFromClone(
  styleBlock: Record<string, unknown>,
  material: Record<string, unknown>,
): TextFontIdentity {
  const font = styleBlock.font as Record<string, unknown>;
  const fontsEntry = firstFontEntry(material);
  const path = str(font.path) as string;
  const id = str(font.id) ?? str(material.font_id) ?? str(material.font_resource_id) ?? str(fontsEntry?.resource_id) ?? "";
  const resourceId = str(material.font_resource_id) ?? str(fontsEntry?.resource_id) ?? id;
  return {
    path,
    id,
    title: str(material.font_title) ?? str(fontsEntry?.title) ?? "",
    resourceId,
    sourcePlatform: num(material.font_source_platform) ?? num(fontsEntry?.source_platform) ?? 0,
    fontsEntry,
  };
}

function resolveEffectiveTextStyle(
  opts: CascadeWordsOptions,
  cloneTpl: { styleBlock: Record<string, unknown>; material: Record<string, unknown> } | undefined,
): EffectiveTextStyle & { font: TextFontIdentity; spanStyle?: Record<string, unknown> } {
  if (opts.font) {
    const font = fontIdentityFromResolved(opts.font);
    const fontSize = opts.fontSize ?? num(cloneTpl?.styleBlock.size) ?? num(cloneTpl?.material.font_size) ?? 15;
    const letterSpacing = cloneTpl ? (num(cloneTpl.material.letter_spacing) ?? 0) : 0;
    return {
      fontPath: font.path,
      fontId: font.id,
      fontTitle: font.title ?? "",
      fontSize,
      letterSpacing,
      clonedStyle: cloneTpl?.styleBlock,
      font,
      spanStyle: cloneTpl ? { ...cloneTpl.styleBlock, size: fontSize, font: { path: font.path, id: font.id } } : undefined,
    };
  }

  if (cloneTpl) {
    const font = fontIdentityFromClone(cloneTpl.styleBlock, cloneTpl.material);
    const fontSize = opts.fontSize ?? num(cloneTpl.styleBlock.size) ?? num(cloneTpl.material.font_size) ?? 15;
    return {
      fontPath: font.path,
      fontId: font.id,
      fontTitle: font.title ?? "",
      fontSize,
      letterSpacing: num(cloneTpl.material.letter_spacing) ?? 0,
      clonedStyle: cloneTpl.styleBlock,
      font,
      spanStyle: { ...cloneTpl.styleBlock, size: fontSize, font: { path: font.path, id: font.id } },
    };
  }

  die("cascade-words: either --font <name|resource_id> or --clone-style is required before generating measurable text");
}

export function cascadeWords(
  draft: Draft,
  _filePath: string,
  opts: CascadeWordsOptions,
): { trackIds: string[]; wordCount: number; lineCount: number } {
  if (!Array.isArray(opts.cards) || opts.cards.length === 0) die("cascade-words: cards must be a non-empty array");

  const guideTrack = draft.tracks.find((t) => t.type === "text" && t.name === opts.guideTrackName);
  if (!guideTrack) die(`cascade-words: guide track "${opts.guideTrackName}" not found`);
  // A guide track can hold multiple sentence segments (repeated import-captions/
  // cascade-words calls, one per sentence). Each call must anchor to ITS OWN
  // sentence's guide segment, not always the first — pick the first one not yet
  // consumed. Consumption is tracked via a private `cascade_words_consumed` marker
  // (NOT `segment.visible` — CapCut's eye-icon toggle only flips track.attribute;
  // a segment-level `visible=false` sticks forever and can't be undone from the UI,
  // which breaks the "hidden, not deleted — reversible" guarantee. The marker key is
  // outside CapCut's own schema, so it round-trips harmlessly through save/load).
  if (guideTrack.segments.length === 0) die(`cascade-words: guide track "${opts.guideTrackName}" has no segments`);
  const guideSeg = guideTrack.segments.find((s) => !s.cascade_words_consumed);
  if (!guideSeg) {
    die(
      `cascade-words: guide track "${opts.guideTrackName}" has no available (unconsumed) segment — all ${guideTrack.segments.length} already consumed`,
    );
  }
  const guideEnd = guideSeg.target_timerange.start + guideSeg.target_timerange.duration;

  const trackPrefix = opts.trackPrefix ?? "word";
  const linePrefix = opts.linePrefix ?? "line";
  checkPrefixCollision(draft, trackPrefix, "--track-prefix");
  checkPrefixCollision(draft, linePrefix, "--line-prefix");

  const canvasWidth = draft.canvas_config?.width;
  if (!Number.isFinite(canvasWidth) || (canvasWidth as number) <= 0) {
    die("cascade-words: draft.canvas_config.width must be a positive number");
  }

  const baseHex = opts.color ?? "#FFFFFF";
  const baseRgb = hexToRgb(baseHex);
  const highlightHex = opts.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const highlightRgb = hexToRgb(highlightHex);
  const alignment = opts.alignment ?? 1;
  const texts = draft.materials.texts as unknown as Array<Record<string, unknown>>;

  const cloneTpl = opts.cloneStyle
    ? resolveCloneStyle(texts, guideSeg, opts.guideTrackName, "cascade-words")
    : undefined;
  if (cloneTpl) ensureCloneIsMeasurable(cloneTpl, opts.guideTrackName);
  const effectiveStyle = resolveEffectiveTextStyle(opts, cloneTpl);
  const fontSize = effectiveStyle.fontSize;

  opts.cards.forEach((card, i) => {
    if (typeof card.text !== "string") die(`cascade-words: cards[${i}] missing string field "text"`);
    if (!Number.isFinite(card.start) || !Number.isFinite(card.end)) {
      die(`cascade-words: cards[${i}] "start"/"end" must be numbers (microseconds)`);
    }
  });

  const lineOf = opts.maxChars !== undefined ? groupLines(opts.cards, opts.maxChars) : opts.cards.map(() => 0);
  const { starts: lineStarts, ends: lineEnds } = computeLineBounds(opts.cards, lineOf, guideEnd);
  const { lineTexts, charRanges } = buildLineTexts(opts.cards, lineOf);

  const wordWidth = padWidth(opts.cards.length);
  const lineWidth = padWidth(lineTexts.length);
  const cardsByLine: number[][] = Array.from({ length: lineTexts.length }, () => []);
  opts.cards.forEach((_, i) => {
    cardsByLine[lineOf[i]].push(i);
  });

  const trackIds: string[] = [];
  let wordCount = 0;
  let lineCount = 0;

  cardsByLine.forEach((indices, line) => {
    const lineStart = lineStarts[line];
    const lineEnd = lineEnds[line];
    if (lineEnd <= lineStart) {
      process.stderr.write(
        `[cascade-words] skipping line ${line} ("${lineTexts[line]}") — degenerate window [${lineStart}, ${lineEnd})\n`,
      );
      return;
    }

    const baseTrack: Track = {
      id: uuid(),
      type: "text",
      name: `${linePrefix}-${String(line).padStart(lineWidth, "0")}`,
      // attribute bit 2 = hidden (inspect.ts: `hidden: !!(t.attribute & 2)`) — this is
      // what CapCut's track-header eye icon actually reads; a lone segment-level
      // `visible=false` does NOT toggle it.
      attribute: 2,
      segments: [],
      is_default_name: false,
      flag: 0,
    } as unknown as Track;
    const baseMatId = uuid();
    if (cloneTpl) {
      const mat = JSON.parse(JSON.stringify(cloneTpl.material)) as Record<string, unknown>;
      mat.id = baseMatId;
      mat.content = buildRichTextContent(lineTexts[line], fontSize, baseRgb, [], effectiveStyle.spanStyle);
      mat.base_content = lineTexts[line];
      if ("recognize_text" in mat) mat.recognize_text = lineTexts[line];
      mat.is_rich_text = true;
      mat.font_size = fontSize;
      mat.letter_spacing = effectiveStyle.letterSpacing;
      applyTextFontIdentity(mat, effectiveStyle.font);
      texts.push(mat);
    } else {
      texts.push(
        buildTextMaterial(baseMatId, lineTexts[line], fontSize, baseRgb, baseHex, alignment, [], effectiveStyle.font),
      );
    }
    const baseCompanions = createCompanionMaterials("text");
    registerCompanions(draft, baseCompanions);
    const baseSeg: Segment = baseSegment(
      uuid(),
      baseMatId,
      baseTrack.id,
      { start: lineStart, duration: lineEnd - lineStart },
      baseCompanions.ids,
      15000,
    );
    // The base line is a placement GUIDE only (used to line up the highlight words so
    // they read as a coherent sentence) — never meant to be seen itself. Hidden via the
    // track's attribute bit (set above) only — NOT segment.visible, which sticks even
    // after the CapCut eye-icon toggle is clicked back on (breaks reversibility).
    baseTrack.segments.push(baseSeg);
    draft.tracks.push(baseTrack);
    trackIds.push(baseTrack.id);
    lineCount++;

    const lineTextLen = lineTexts[line].length;
    const lineMid = lineTextLen / 2;
    const charWidthPx = fontSize * CHAR_WIDTH_FACTOR;

    indices.forEach((i) => {
      const card = opts.cards[i];
      if (card.start >= lineEnd) {
        process.stderr.write(
          `[cascade-words] skipping cards[${i}] ("${card.text}") — start ${card.start} >= line end ${lineEnd}\n`,
        );
        return;
      }

      const [charStart, charEnd] = charRanges[i];
      const wordMid = (charStart + charEnd) / 2;
      const x = ((wordMid - lineMid) * charWidthPx) / ((canvasWidth as number) / 2);

      const track: Track = {
        id: uuid(),
        type: "text",
        name: `${trackPrefix}-${String(i).padStart(wordWidth, "0")}`,
        attribute: 0,
        segments: [],
        is_default_name: false,
        flag: 0,
      } as unknown as Track;

      const matId = uuid();
      if (cloneTpl) {
        const mat = JSON.parse(JSON.stringify(cloneTpl.material)) as Record<string, unknown>;
        mat.id = matId;
        mat.content = buildRichTextContent(card.text, fontSize, highlightRgb, [], effectiveStyle.spanStyle);
        mat.base_content = card.text;
        if ("recognize_text" in mat) mat.recognize_text = card.text;
        mat.is_rich_text = true;
        mat.font_size = fontSize;
        mat.letter_spacing = effectiveStyle.letterSpacing;
        applyTextFontIdentity(mat, effectiveStyle.font);
        texts.push(mat);
      } else {
        texts.push(
          buildTextMaterial(matId, card.text, fontSize, highlightRgb, highlightHex, alignment, [], effectiveStyle.font),
        );
      }

      const companions = createCompanionMaterials("text");
      registerCompanions(draft, companions);
      const duration = lineEnd - card.start;
      const seg: Segment = baseSegment(uuid(), matId, track.id, { start: card.start, duration }, companions.ids, 15000);
      if (seg.clip) seg.clip.transform.x = x;
      track.segments.push(seg);
      draft.tracks.push(track);
      trackIds.push(track.id);
      wordCount++;
    });
  });

  // Mark the guide segment THIS call consumed (bookkeeping only, see the selection
  // comment above — NOT segment.visible), and hide the whole guide track (attribute
  // bit 2 — the actual eye-icon toggle CapCut's UI reads; see the baseTrack comment
  // above). The guide is pure scratch, never meant to be shown — safe to hide the
  // whole track even if other not-yet-processed sentence segments still live on it
  // (their own cascade-words call will consume them later; hiding the track doesn't
  // touch their data).
  guideSeg.cascade_words_consumed = true;
  guideTrack.attribute |= 2;

  if (guideEnd > (draft.duration ?? 0)) draft.duration = guideEnd;
  return { trackIds, wordCount, lineCount };
}

export function cmdCascadeWords(draft: Draft, filePath: string, positional: string[], flags: Flags): void {
  const jsonPath = positional[2];
  if (!jsonPath) {
    die(
      "Missing <cards.json>. Usage: capcut-david cascade-words <project> <cards.json> --guide-track <name> (--font <name|rid> | --clone-style) [--track-prefix <name>] [--line-prefix <name>] [--font-size <n>] [--color <hex>] [--highlight-color <hex>] [--align <0|1|2>] [--max-chars <n>]",
    );
  }
  if (!existsSync(jsonPath)) die(`Cards file not found: ${jsonPath}`);
  let cards: CaptionCard[];
  try {
    cards = JSON.parse(readFileSync(jsonPath, "utf-8")) as CaptionCard[];
  } catch (e) {
    die(`Invalid JSON in ${jsonPath}: ${(e as Error).message}`);
  }
  if (!Array.isArray(cards)) die("Cards file must be a JSON array of {text,start,end}");
  if (!flags.guideTrack) die("--guide-track <name> is required");

  const result = cascadeWords(draft, filePath, {
    cards,
    guideTrackName: flags.guideTrack,
    trackPrefix: flags.trackPrefix,
    linePrefix: flags.linePrefix,
    fontSize: flags.fontSize,
    color: flags.color,
    highlightColor: flags.highlightColor,
    alignment: flags.align,
    cloneStyle: flags.cloneStyle,
    font: flags.font ? resolveFontReference(flags.font, { draftsRoot: flags.drafts }) : undefined,
    maxChars: flags.maxChars,
  });
  saveDraft(filePath, draft);
  out({ ok: true, track_ids: result.trackIds, word_count: result.wordCount, line_count: result.lineCount }, flags);
}
