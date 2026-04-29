// TikTok-style karaoke ASS subtitle generator.
//
// Produces an ASS file where 3-4 words are shown at a time and the currently
// spoken word is highlighted in `highlightColor` while the rest of the visible
// phrase stays in `primaryColor`. Timing is driven by per-word start/end
// timestamps from ElevenLabs.

import type { WordTiming } from "./elevenlabs.js";

export interface SubtitleStyle {
  primaryColor: string;   // hex e.g. "#FFFFFF" — base text color
  highlightColor: string; // hex e.g. "#EEF4ED" — current-word color
  fontFamily: string;     // e.g. "Inter"
  fontSize: number;       // px (in a 1080x1920 canvas)
  marginV: number;        // distance from bottom in px
  outlineColor?: string;  // hex e.g. "#000000"
  outlineWidth?: number;  // px
  shadowDepth?: number;   // px
  wordsPerPhrase?: number;// words shown on screen at once (default 3)
}

// Convert "#RRGGBB" to ASS color literal "&H00BBGGRR&" (BGR order, no alpha).
function hexToAss(hex: string): string {
  const m = hex.replace("#", "").toUpperCase();
  if (m.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
  const rr = m.slice(0, 2);
  const gg = m.slice(2, 4);
  const bb = m.slice(4, 6);
  return `&H00${bb}${gg}${rr}&`;
}

// Format seconds as ASS time "H:MM:SS.cc" (centiseconds).
function fmtTime(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  // cs can round up to 100; carry it.
  if (cs === 100) {
    return fmtTime(Math.floor(sec) + 1);
  }
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Escape a word for use inside an ASS Dialogue Text field. ASS treats `{` as
// an override-block opener and `\` as an escape, so we neutralize both.
function escapeText(word: string): string {
  return word.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

interface Phrase {
  words: WordTiming[];
}

function chunkWords(words: WordTiming[], size: number): Phrase[] {
  const phrases: Phrase[] = [];
  for (let i = 0; i < words.length; i += size) {
    phrases.push({ words: words.slice(i, i + size) });
  }
  return phrases;
}

export function buildAssSubtitles(words: WordTiming[], style: SubtitleStyle): string {
  const primary = hexToAss(style.primaryColor);
  const highlight = hexToAss(style.highlightColor);
  const outline = hexToAss(style.outlineColor ?? "#000000");
  const outlineWidth = style.outlineWidth ?? 4;
  const shadow = style.shadowDepth ?? 2;
  const phraseSize = Math.max(1, style.wordsPerPhrase ?? 3);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Karaoke,${style.fontFamily},${style.fontSize},${primary},${primary},${outline},&H00000000&,1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},2,60,60,${style.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const phrases = chunkWords(words, phraseSize);
  const lines: string[] = [];

  for (const phrase of phrases) {
    if (phrase.words.length === 0) continue;
    // For each word in the phrase, emit one Dialogue line shown for the
    // duration that word is being spoken. The line displays the whole phrase
    // with this word colored in `highlight`.
    for (let i = 0; i < phrase.words.length; i++) {
      const current = phrase.words[i];
      if (!current) continue;
      const start = fmtTime(current.startS);
      const end = fmtTime(current.endS);

      const parts: string[] = [];
      for (let j = 0; j < phrase.words.length; j++) {
        const wt = phrase.words[j];
        if (!wt) continue;
        const w = escapeText(wt.word);
        if (j === i) {
          parts.push(`{\\1c${highlight}}${w}{\\1c${primary}}`);
        } else {
          parts.push(w);
        }
      }
      const text = parts.join(" ");
      lines.push(`Dialogue: 0,${start},${end},Karaoke,,0,0,0,,${text}`);
    }
  }

  return `${header}\n${lines.join("\n")}\n`;
}
