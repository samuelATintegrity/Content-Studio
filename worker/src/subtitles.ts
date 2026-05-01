// TikTok-style karaoke ASS subtitle generator.
//
// One Dialogue per phrase. Inside each Dialogue, per-word `\t` color
// transforms light up the currently-spoken word in `highlightColor` while
// neighbours stay in `primaryColor`. Each phrase enters with a blur fade and
// a small upward slide into its resting position.
//
// Display rules:
//   - All caps
//   - Punctuation stripped from the visual text (audio still uses it for prosody)
//   - Anchored mid-lower in a 1080x1920 canvas, with a healthy outline and
//     drop shadow for legibility over varied footage.

import type { WordTiming } from "./elevenlabs.js";

export interface SubtitleStyle {
  primaryColor: string;   // hex, e.g. "#FFFFFF" — base text color
  highlightColor: string; // hex, e.g. "#FFD400" — current-word color
  fontFamily: string;     // e.g. "Inter"
  fontSize: number;       // px in 1080x1920
  marginV: number;        // distance from bottom in px (resting position)
  outlineColor?: string;  // hex, defaults to black
  outlineWidth?: number;  // px, defaults to 6
  shadowDepth?: number;   // px, defaults to 3
  wordsPerPhrase?: number;// words shown on screen at once (default 3)
  entranceMs?: number;    // entrance animation duration in ms (default 280)
  entranceLiftPx?: number;// how far to slide upward into rest (default 35)
}

// A resolved title-card span ready for rendering. Pipeline derives these
// from Claude's title moments by phrase-matching against TTS word timings.
export interface TitleSpan {
  startS: number;     // when the spoken phrase begins
  endS: number;       // when it ends (already extended to TITLE_MIN_DURATION_S if needed)
  label: string;      // on-screen text (typically ALL CAPS)
  leadInS?: number;   // optional lead-in fade-in seconds (defaults 0.1)
  tailS?: number;     // optional fade-out tail seconds (defaults 0.2)
}

// TitleCard visual style. Sized big, centered top-third in the 9:16 frame
// so it sits well clear of the karaoke band along the bottom.
const TITLE_FONT_FAMILY = "Prata";
const TITLE_FONT_SIZE = 140;
const TITLE_MARGIN_V = 280;        // distance from TOP (alignment 8 = top-center)
const TITLE_OUTLINE_WIDTH = 4;
const TITLE_SHADOW_DEPTH = 4;
const TITLE_LETTER_SPACING = 6;
const TITLE_FADE_IN_MS = 150;
const TITLE_FADE_OUT_MS = 250;

const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

function hexToAss(hex: string): string {
  const m = hex.replace("#", "").toUpperCase();
  if (m.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
  const rr = m.slice(0, 2);
  const gg = m.slice(2, 4);
  const bb = m.slice(4, 6);
  return `&H00${bb}${gg}${rr}&`;
}

function fmtTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  if (cs === 100) return fmtTime(Math.floor(sec) + 1);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Strip punctuation and uppercase. Audio side keeps the original text — this
// transform applies only to what's drawn on screen.
function visualText(word: string): string {
  return word
    .toUpperCase()
    .replace(/[.,!?;:'"`()[\]{}]/g, "")
    .replace(/[—–]/g, "");
}

// Escape a literal-text segment for the Dialogue Text field. ASS treats `{`
// as an override-block opener and `\` as an escape character.
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

interface Phrase {
  words: WordTiming[];
}

function chunkWords(words: WordTiming[], size: number): Phrase[] {
  const out: Phrase[] = [];
  for (let i = 0; i < words.length; i += size) {
    out.push({ words: words.slice(i, i + size) });
  }
  return out;
}

// Does a karaoke phrase visually overlap any title span? We compare the
// phrase's MIDPOINT to each title's [startS, endS] — if the midpoint
// lands inside a title window, suppress the phrase so the title gets the
// stage to itself. Title spans are short (<1s typical), phrases run
// ~0.9–1.2s, so at most one phrase gets dropped per title.
function phraseOverlapsTitle(
  phraseStart: number,
  phraseEnd: number,
  titleSpans: TitleSpan[],
): boolean {
  if (titleSpans.length === 0) return false;
  const mid = (phraseStart + phraseEnd) / 2;
  for (const t of titleSpans) {
    if (mid >= t.startS && mid <= t.endS) return true;
  }
  return false;
}

export function buildAssSubtitles(
  words: WordTiming[],
  style: SubtitleStyle,
  titleSpans: TitleSpan[] = [],
): string {
  if (words.length === 0) {
    return buildHeader(style, titleSpans.length > 0) + "\n";
  }
  const primary = hexToAss(style.primaryColor);
  const highlight = hexToAss(style.highlightColor);

  const phraseSize = Math.max(1, style.wordsPerPhrase ?? 3);
  const entranceMs = style.entranceMs ?? 280;
  const liftPx = style.entranceLiftPx ?? 35;

  // Resting anchor (bottom-center alignment, raised by marginV).
  const restingY = PLAY_RES_Y - style.marginV;
  const startY = restingY + liftPx; // enters from below, slides up
  const centerX = PLAY_RES_X / 2;

  const phrases = chunkWords(words, phraseSize);
  const lines: string[] = [];

  for (const phrase of phrases) {
    if (phrase.words.length === 0) continue;
    const first = phrase.words[0]!;
    const last = phrase.words[phrase.words.length - 1]!;
    const phraseStart = first.startS;
    // Hold the phrase a touch past its last word so the highlight on the
    // final word doesn't immediately vanish.
    const phraseEnd = last.endS + 0.05;

    // Skip phrases that overlap a title window — the title takes over the
    // visual track at that moment and captions resume after.
    if (phraseOverlapsTitle(phraseStart, phraseEnd, titleSpans)) continue;

    const phraseDurationMs = Math.max(1, Math.round((phraseEnd - phraseStart) * 1000));

    const moveT2 = Math.min(entranceMs, phraseDurationMs);

    // Header tags applied once at the start of the Dialogue: position via
    // \move (entrance lift), \fad fade-in, \blur that animates to sharp.
    const headerTags =
      `{\\an2` +
      `\\fad(${moveT2},0)` +
      `\\move(${centerX.toFixed(0)},${startY.toFixed(0)},${centerX.toFixed(0)},${restingY.toFixed(0)},0,${moveT2})` +
      `\\blur5\\t(0,${moveT2},\\blur0)` +
      `\\1c${primary}}`;

    // Per-word body: each word resets color to base, then schedules a
    // highlight on/off pair via \t around its spoken window. Resetting before
    // each word prevents the highlight color from leaking into the next.
    const bodyParts: string[] = [];
    for (let i = 0; i < phrase.words.length; i++) {
      const w = phrase.words[i]!;
      const sMs = Math.max(0, Math.round((w.startS - phraseStart) * 1000));
      const eMs = Math.max(sMs + 1, Math.round((w.endS - phraseStart) * 1000));
      const visible = escapeText(visualText(w.word));
      if (visible.length === 0) continue;
      const reset = i === 0 ? "" : `{\\1c${primary}}`;
      bodyParts.push(
        `${reset}{\\t(${sMs},${sMs},\\1c${highlight})\\t(${eMs},${eMs},\\1c${primary})}${visible}`,
      );
    }
    const body = bodyParts.join(" ");

    const startStr = fmtTime(phraseStart);
    const endStr = fmtTime(phraseEnd);
    lines.push(`Dialogue: 0,${startStr},${endStr},Karaoke,,0,0,0,,${headerTags}${body}`);
  }

  // Title-card Dialogues. Each one fires a beat early (lead-in) and holds
  // a beat past the spoken phrase (tail). The TitleCard style sits top-center
  // in the upper third, well clear of the karaoke band.
  for (const t of titleSpans) {
    const leadIn = t.leadInS ?? 0.1;
    const tail = t.tailS ?? 0.2;
    const startStr = fmtTime(Math.max(0, t.startS - leadIn));
    const endStr = fmtTime(t.endS + tail);
    const visible = escapeText(visualText(t.label));
    if (!visible) continue;
    const tags =
      `{\\an8\\fad(${TITLE_FADE_IN_MS},${TITLE_FADE_OUT_MS})\\blur1}`;
    lines.push(`Dialogue: 0,${startStr},${endStr},TitleCard,,0,0,0,,${tags}${visible}`);
  }

  return `${buildHeader(style, titleSpans.length > 0)}\n${lines.join("\n")}\n`;
}

function buildHeader(style: SubtitleStyle, includeTitleStyle: boolean): string {
  const primary = hexToAss(style.primaryColor);
  const outline = hexToAss(style.outlineColor ?? "#000000");
  const outlineWidth = style.outlineWidth ?? 6;
  const shadow = style.shadowDepth ?? 3;

  // TitleCard style: white Prata, black outline, large, top-center anchor,
  // editorial letter-spacing. Alignment 8 = top-center; MarginV is distance
  // from top in this anchor mode.
  const titleWhite = hexToAss("#FFFFFF");
  const titleOutline = hexToAss("#000000");

  const styles: string[] = [
    `Style: Karaoke,${style.fontFamily},${style.fontSize},${primary},${primary},${outline},&H00000000&,1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},2,80,80,${style.marginV},1`,
  ];
  if (includeTitleStyle) {
    styles.push(
      `Style: TitleCard,${TITLE_FONT_FAMILY},${TITLE_FONT_SIZE},${titleWhite},${titleWhite},${titleOutline},&H00000000&,0,0,0,0,100,100,${TITLE_LETTER_SPACING},0,1,${TITLE_OUTLINE_WIDTH},${TITLE_SHADOW_DEPTH},8,40,40,${TITLE_MARGIN_V},1`,
    );
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${PLAY_RES_X}`,
    `PlayResY: ${PLAY_RES_Y}`,
    // WrapStyle 0 = smart balanced wrap. Long phrases break onto 2 lines
    // instead of overflowing the canvas.
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}
