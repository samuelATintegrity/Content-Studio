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
  wordsPerPhrase?: number;// max words shown on screen at once (default 3) —
                          // phrases also break early on sentence-end punctuation
  entranceMs?: number;    // entrance animation duration in ms (default 280)
  entranceLiftPx?: number;// how far to slide upward into rest (default 35)
}

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

// Test for sentence-ending punctuation on a word's original (pre-strip)
// text. Matches `.`, `!`, `?` — optionally followed by a closing quote/paren
// — at the very end of the word. Common abbreviations like "etc." would
// also match, but those are vanishingly rare in our real-estate scripts.
const SENTENCE_END_RE = /[.!?][")\]”’]?$/u;

// Group words into on-screen phrases. Two break rules:
//   1. Hard cap at `size` words (default 3) so a phrase fits the band
//      without wrapping awkwardly.
//   2. Hard break right after any word ending a sentence (`.!?`). This
//      keeps the final word of a sentence on screen alone through the
//      narrator's pause, instead of pulling the next sentence's words
//      onscreen too early.
function chunkWords(words: WordTiming[], size: number): Phrase[] {
  const out: Phrase[] = [];
  let buf: WordTiming[] = [];
  for (const w of words) {
    buf.push(w);
    const endsSentence = SENTENCE_END_RE.test(w.word);
    if (endsSentence || buf.length >= size) {
      out.push({ words: buf });
      buf = [];
    }
  }
  if (buf.length > 0) out.push({ words: buf });
  return out;
}

export function buildAssSubtitles(
  words: WordTiming[],
  style: SubtitleStyle,
): string {
  if (words.length === 0) {
    return buildHeader(style) + "\n";
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

  for (let pi = 0; pi < phrases.length; pi++) {
    const phrase = phrases[pi]!;
    if (phrase.words.length === 0) continue;
    const first = phrase.words[0]!;
    const last = phrase.words[phrase.words.length - 1]!;
    const phraseStart = first.startS;
    // Default end: small hold past the last word's audio so the highlight
    // doesn't snap off mid-syllable.
    const naturalEnd = last.endS + 0.05;
    // Extend the on-screen duration to the next phrase's start time when
    // that gap is longer than the natural hold. This keeps the last word
    // of a sentence visible during the narrator's pause (instead of going
    // dark mid-pause, then snapping back when the next phrase begins).
    const next = phrases[pi + 1];
    const phraseEnd = next ? Math.max(naturalEnd, next.words[0]!.startS) : naturalEnd;

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

  return `${buildHeader(style)}\n${lines.join("\n")}\n`;
}

function buildHeader(style: SubtitleStyle): string {
  const primary = hexToAss(style.primaryColor);
  const outline = hexToAss(style.outlineColor ?? "#000000");
  const outlineWidth = style.outlineWidth ?? 6;
  const shadow = style.shadowDepth ?? 3;

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
    `Style: Karaoke,${style.fontFamily},${style.fontSize},${primary},${primary},${outline},&H00000000&,1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},2,80,80,${style.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}
