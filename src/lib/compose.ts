import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import * as opentype from "opentype.js";
import { brand, type FontVariant } from "../../brand.config";
import type { FitMode, Framing, StyleVariant } from "./types";

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function estWidth(text: string, size: number, charsPerEm: number): number {
  return (text.length / charsPerEm) * size;
}

function fitFontSize(text: string, maxWidth: number, baseSize: number, minSize: number, charsPerEm = 1.6): number {
  let size = baseSize;
  while (size > minSize && estWidth(text, size, charsPerEm) > maxWidth) size -= 4;
  return size;
}

interface HeadlineLayout {
  lines: string[];
  size: number;
}

// Greedy line-break: pack as many words as fit into each line at the
// given font size, returning N lines (or undefined if even the longest
// single word doesn't fit at this size).
function greedyWrap(
  words: string[],
  size: number,
  maxWidth: number,
  charsPerEm: number,
): string[] | undefined {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (estWidth(word, size, charsPerEm) > maxWidth) {
      // Even one word overflows at this size — caller should drop size.
      return undefined;
    }
    const candidate = current ? current + " " + word : word;
    if (estWidth(candidate, size, charsPerEm) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Ellipsize a string in place by repeatedly dropping the last word and
// appending "…" until it fits at the given size, or returning a hard
// truncation by characters as a final fallback.
function ellipsize(line: string, size: number, maxWidth: number, charsPerEm: number): string {
  if (estWidth(line, size, charsPerEm) <= maxWidth) return line;
  const words = line.split(/\s+/);
  for (let i = words.length - 1; i >= 1; i--) {
    const candidate = words.slice(0, i).join(" ") + "…";
    if (estWidth(candidate, size, charsPerEm) <= maxWidth) return candidate;
  }
  // Single very-long word — chop characters.
  let s = line;
  while (s.length > 4 && estWidth(s + "…", size, charsPerEm) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

// Layout the headline so it always fits inside the band:
//   1. Try one line at base size, stepping down to minSize. If it
//      still overflows, fall through to wrapping.
//   2. Try 2 lines (then 3) at base, stepping the size down to minSize
//      until every line fits. The first acceptable wrap wins.
//   3. As a last resort, force 3 lines at minSize and ellipsize the
//      last line so text never bleeds past the band edge.
//
// Min size is 44 px (down from 56) to give headlines a real chance to
// fit without truncation. Combined with the upstream Claude prompt cap
// (max 4 words / 32 chars), most calls land at 1-2 lines and the fall-
// through paths are insurance, not the common case.
function layoutHeadline(text: string, maxWidth: number, baseSize: number, minSize: number, charsPerEm: number): HeadlineLayout {
  // 1. One line at any size between base and min.
  const oneLine = fitFontSize(text, maxWidth, baseSize, minSize, charsPerEm);
  if (estWidth(text, oneLine, charsPerEm) <= maxWidth) {
    return { lines: [text], size: oneLine };
  }

  const words = text.split(/\s+/);
  if (words.length < 2) {
    // Single word that overflows — ellipsize at minSize.
    return { lines: [ellipsize(text, minSize, maxWidth, charsPerEm)], size: minSize };
  }

  // 2. Wrapping. Step down by 4px from base; at each size, take the
  //    first wrap whose line count is ≤ maxLines AND every line fits.
  for (let size = baseSize; size >= minSize; size -= 4) {
    for (const maxLines of [2, 3]) {
      const lines = greedyWrap(words, size, maxWidth, charsPerEm);
      if (!lines) continue;
      if (lines.length <= maxLines && lines.every((ln) => estWidth(ln, size, charsPerEm) <= maxWidth)) {
        return { lines, size };
      }
    }
  }

  // 3. Last resort — 3 lines at minSize, ellipsizing the final line.
  const wrapped = greedyWrap(words, minSize, maxWidth, charsPerEm) ?? [text];
  const trimmed = wrapped.slice(0, 3);
  if (wrapped.length > 3) {
    trimmed[2] = ellipsize(trimmed[2], minSize, maxWidth, charsPerEm);
  }
  // Ensure no individual line still overflows at minSize.
  return {
    lines: trimmed.map((ln) => ellipsize(ln, minSize, maxWidth, charsPerEm)),
    size: minSize,
  };
}

// Per-variant cache of parsed opentype.Font instances. We render text by
// converting strings to SVG <path> elements rather than relying on librsvg
// to honor an @font-face data URI (which it does NOT do reliably when SVG
// is composited as an overlay onto a raster via sharp).
const fontCache = new Map<FontVariant, opentype.Font>();

async function loadFont(variant: FontVariant): Promise<opentype.Font | null> {
  const def = brand.fonts[variant];
  if (!def.file) return null;
  const cached = fontCache.get(variant);
  if (cached) return cached;

  const fsPath = path.join(process.cwd(), "public", def.file.replace(/^\//, ""));
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(fsPath);
  } catch (e) {
    console.error(`[compose] font file unreadable for variant "${variant}" at ${fsPath}: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
  try {
    // opentype.parse expects an ArrayBuffer
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const font = opentype.parse(ab);
    fontCache.set(variant, font);
    return font;
  } catch (e) {
    console.error(`[compose] opentype.parse failed for "${variant}": ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

// Render a string to an SVG <path d="..."> centered horizontally on `centerX`,
// vertically positioned so the visual middle of the cap-line sits at `centerY`.
// Honors `letterSpacing` (extra advance between glyphs, in font units of px).
function textToSvgPath(args: {
  text: string;
  font: opentype.Font;
  fontSize: number;
  centerX: number;
  centerY: number;
  fill: string;
  letterSpacing?: number;
}): string {
  const { text, font, fontSize, centerX, centerY, fill, letterSpacing = 0 } = args;
  if (!text) return "";

  // We walk characters via `charToGlyph` instead of `stringToGlyphs` because
  // Inter Bold uses a GSUB substitution feature (substFormat: 2) that
  // opentype.js doesn't support — stringToGlyphs throws. charToGlyph skips
  // the substitution layer entirely. For our use (ALL-CAPS headlines + short
  // CTAs) we don't need ligatures.
  const scale = fontSize / font.unitsPerEm;
  const chars = Array.from(text);
  const glyphs = chars.map((ch) => font.charToGlyph(ch));

  // Measure: total advance width with letter-spacing between glyphs.
  let width = 0;
  for (let i = 0; i < glyphs.length; i++) {
    width += (glyphs[i].advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) width += letterSpacing;
  }

  // Vertical center: position baseline so the visual midpoint of the cap-line
  // sits on centerY. ascender + descender (signed) gives the font's vertical
  // extent; halving and shifting moves the baseline accordingly.
  const ascender = font.ascender * scale;
  const descender = font.descender * scale; // negative
  const visualMid = (ascender + descender) / 2;
  const baselineY = centerY + visualMid;

  const startX = centerX - width / 2;

  let d = "";
  let x = startX;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const gp = g.getPath(x, baselineY, fontSize);
    d += (d ? " " : "") + gp.toPathData(2);
    x += (g.advanceWidth ?? 0) * scale + letterSpacing;
  }

  return `<path d="${d}" fill="${fill}"/>`;
}

interface ComposeArgs {
  photoBytes: Buffer;
  headline: string;
  cta: string;
  handle?: string;
  fontVariant?: FontVariant;
  framing?: Framing;
  fitMode?: FitMode;
  style?: StyleVariant;
}

function computeCrop(scale: number, x: number, y: number, regionW: number, regionH: number) {
  // 1.0 = exact cover-fit (no extra crop beyond what aspect-ratio mismatch already
  // forces). Pan room only exists when the user explicitly zooms past 1.0.
  const eff = Math.max(scale, 1.0);
  const targetW = Math.round(regionW * eff);
  const targetH = Math.round(regionH * eff);
  const extraW = targetW - regionW;
  const extraH = targetH - regionH;
  const xClamped = Math.max(-100, Math.min(100, x));
  const yClamped = Math.max(-100, Math.min(100, y));
  const left = Math.round(extraW / 2 + (extraW / 2) * (xClamped / 100));
  const top = Math.round(extraH / 2 + (extraH / 2) * (yClamped / 100));
  return {
    targetW,
    targetH,
    extractLeft: Math.max(0, Math.min(extraW, left)),
    extractTop: Math.max(0, Math.min(extraH, top)),
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export async function composeImage({
  photoBytes,
  headline,
  cta,
  handle,
  fontVariant = "sans",
  framing = { x: 0, y: 0, scale: 1.0 },
  fitMode = "contain",
  style = "branded",
}: ComposeArgs): Promise<Buffer> {
  const { topHeightPx, bottomHeightPx } = brand.bands;
  const handleStr = handle ?? brand.handle;
  const font = brand.fonts[fontVariant];
  const styleCfg = brand.styles[style];

  // Resolve effective colors. Branded uses brand.colors; other styles override.
  const bandTopColor = styleCfg.bandTop ?? brand.colors.primary;
  const bandBottomColor = styleCfg.bandBottom ?? brand.colors.secondary;
  const textTopColor = styleCfg.textTop ?? brand.colors.text;
  const textBottomColor = styleCfg.textBottom ?? brand.colors.textSecondary;

  // For cover/contain modes the photo region depends on the style: full-bleed
  // styles use the whole canvas, otherwise the photo sits between the bands.
  // For MANUAL mode the photo always uses the full canvas so the editor's frame
  // matches the final output one-to-one (bands then composite on top of it).
  const fullBleed = styleCfg.fullBleed;
  const isManual = fitMode === "manual";
  const useFullCanvas = isManual || fullBleed;
  const photoRegionTop = useFullCanvas ? 0 : topHeightPx;
  const photoRegionH = useFullCanvas ? CANVAS_H : CANVAS_H - topHeightPx - bottomHeightPx;
  const photoRegionW = CANVAS_W;

  // Background of the full canvas matches the top band so contain-mode side bars
  // and any uncovered manual-mode area read consistently.
  const bgRgb = hexToRgb(bandTopColor);
  let canvas = sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 3,
      background: bgRgb,
    },
  })
    .png()
    .toBuffer();
  let base = await canvas;

  if (fitMode === "manual") {
    // Free placement: scale ≥0.3 shrinks, scale ≤1.0 = exact cover, >1.0 zooms in.
    // x/y are pixel offsets from region center; can push photo partly out of frame.
    const meta = await sharp(photoBytes).metadata();
    const sw = meta.width ?? photoRegionW;
    const sh = meta.height ?? photoRegionH;
    const baseRatio = Math.max(photoRegionW / sw, photoRegionH / sh);
    const finalW = Math.max(1, Math.round(sw * baseRatio * framing.scale));
    const finalH = Math.max(1, Math.round(sh * baseRatio * framing.scale));
    const resized = await sharp(photoBytes).resize(finalW, finalH, { fit: "fill" }).toBuffer();

    const photoLeft = Math.round(photoRegionW / 2 - finalW / 2 + framing.x);
    const photoTop = Math.round(photoRegionH / 2 - finalH / 2 + framing.y);

    const visSrcL = Math.max(0, -photoLeft);
    const visSrcT = Math.max(0, -photoTop);
    const visDstL = Math.max(0, photoLeft);
    const visDstT = Math.max(0, photoTop);
    const visW = Math.min(finalW - visSrcL, photoRegionW - visDstL);
    const visH = Math.min(finalH - visSrcT, photoRegionH - visDstT);

    let region = await sharp({
      create: {
        width: photoRegionW,
        height: photoRegionH,
        channels: 3,
        background: bgRgb,
      },
    })
      .png()
      .toBuffer();

    if (visW > 0 && visH > 0) {
      const visiblePhoto = await sharp(resized)
        .extract({ left: visSrcL, top: visSrcT, width: visW, height: visH })
        .toBuffer();
      region = await sharp(region)
        .composite([{ input: visiblePhoto, top: visDstT, left: visDstL }])
        .png()
        .toBuffer();
    }

    base = await sharp(base)
      .composite([{ input: region, top: photoRegionTop, left: 0 }])
      .png()
      .toBuffer();
  } else if (fitMode === "cover") {
    const { targetW, targetH, extractLeft, extractTop } = computeCrop(framing.scale, framing.x, framing.y, photoRegionW, photoRegionH);
    const resized = await sharp(photoBytes)
      .resize(targetW, targetH, { fit: "cover", position: "centre" })
      .toBuffer();
    const cropped = await sharp(resized)
      .extract({ left: extractLeft, top: extractTop, width: photoRegionW, height: photoRegionH })
      .toBuffer();
    base = await sharp(base)
      .composite([{ input: cropped, top: photoRegionTop, left: 0 }])
      .png()
      .toBuffer();
  } else {
    // contain: resize photo to fit fully inside the photo region, center it,
    // brand-color bars fill any leftover horizontal/vertical space.
    const fitted = await sharp(photoBytes)
      .resize(photoRegionW, photoRegionH, { fit: "inside", withoutEnlargement: false })
      .toBuffer();
    const meta = await sharp(fitted).metadata();
    const fitW = meta.width ?? photoRegionW;
    const fitH = meta.height ?? photoRegionH;
    const padX = Math.round((photoRegionW - fitW) / 2);
    const padY = Math.round((photoRegionH - fitH) / 2);
    base = await sharp(base)
      .composite([{ input: fitted, top: photoRegionTop + padY, left: padX }])
      .png()
      .toBuffer();
  }

  // Apply style treatment to the photo before bands/text go over the top.
  if (styleCfg.photoSaturation !== 1 || styleCfg.photoTint) {
    let pipe = sharp(base);
    if (styleCfg.photoSaturation !== 1) {
      pipe = pipe.modulate({ saturation: styleCfg.photoSaturation });
    }
    if (styleCfg.photoTint) {
      pipe = pipe.tint(styleCfg.photoTint);
    }
    base = await pipe.png().toBuffer();
  }
  if (styleCfg.photoOverlay) {
    const overlay = await sharp({
      create: {
        width: CANVAS_W,
        height: CANVAS_H,
        channels: 4,
        background: styleCfg.photoOverlay,
      },
    })
      .png()
      .toBuffer();
    base = await sharp(base).composite([{ input: overlay }]).png().toBuffer();
  }

  // Plain style: just the photo, no bands/text/logo. Return early.
  if (style === "plain") {
    return base;
  }

  // Build SVG overlay: top + bottom bands + headline + CTA + handle.
  const isSerif = fontVariant === "serif";
  const charsPerEm = isSerif ? 1.4 : 1.5;
  const headlineDisplay = isSerif ? headline : headline.toUpperCase();
  const headlineLayout = layoutHeadline(headlineDisplay, CANVAS_W - 80, isSerif ? 120 : 110, 44, charsPerEm);
  const ctaSize = fitFontSize(cta, CANVAS_W - 200, 64, 36, charsPerEm);
  const handleSize = 28;

  const topY = 0;
  const bottomY = CANVAS_H - bottomHeightPx;

  // Load the font for path-based rendering. If the load fails we fall back
  // to <text> (which librsvg may render as tofu) but at least keep the box
  // structure intact instead of crashing.
  const otFont = await loadFont(fontVariant);

  const lineHeight = headlineLayout.size * 1.05;
  const totalHeadlineH = lineHeight * headlineLayout.lines.length;
  const headlineStartY = topY + topHeightPx / 2 - totalHeadlineH / 2 + lineHeight / 2;
  const headlineLetterSpacing = isSerif ? 0 : 2;
  const headlineTextEls = headlineLayout.lines
    .map((ln, i) => {
      const cy = headlineStartY + i * lineHeight;
      if (otFont) {
        return textToSvgPath({
          text: ln,
          font: otFont,
          fontSize: headlineLayout.size,
          centerX: CANVAS_W / 2,
          centerY: cy,
          fill: textTopColor,
          letterSpacing: headlineLetterSpacing,
        });
      }
      return `<text x="${CANVAS_W / 2}" y="${cy}" font-family="${font.family}" font-size="${headlineLayout.size}" font-weight="${font.weight}" fill="${textTopColor}" text-anchor="middle" dominant-baseline="middle" ${isSerif ? "" : 'letter-spacing="2"'}>${escapeXml(ln)}</text>`;
    })
    .join("");

  // Position the CTA in the upper portion of the bottom band so there's room
  // below it for the logo (or @handle fallback) to sit centered.
  const ctaCenterY = bottomY + bottomHeightPx * 0.38;
  const subCenterY = bottomY + bottomHeightPx * 0.72;

  // Try to load the logo. If present, it replaces the @handle text below the CTA.
  const logoFsPath = path.join(process.cwd(), "public", brand.logo.replace(/^\//, ""));
  let logoBuf: Buffer | null = null;
  let logoW = 0;
  let logoH = 0;
  try {
    await fs.access(logoFsPath);
    const maxH = Math.round(bottomHeightPx * 0.32);
    const maxW = Math.round(CANVAS_W * 0.55);
    const sized = await sharp(logoFsPath)
      .resize({ height: maxH, width: maxW, fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(sized).metadata();
    const w = meta.width ?? maxH;
    const h = meta.height ?? maxH;

    if (styleCfg.logoTint) {
      // Recolor by using the logo's alpha as a mask over a flat-color rectangle.
      // This produces TRUE color (sharp's `.tint()` preserves luminance and would
      // leave a white logo near-white even with a dark tint color).
      const c = hexToRgb(styleCfg.logoTint);
      const colored = await sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: { r: c.r, g: c.g, b: c.b, alpha: 1 },
        },
      })
        .composite([{ input: sized, blend: "dest-in" }])
        .png()
        .toBuffer();
      logoBuf = colored;
    } else {
      logoBuf = sized;
    }
    logoW = w;
    logoH = h;
  } catch {
    // No logo file — fall back to handle text below.
  }

  const subEl = logoBuf
    ? "" // logo composited separately below
    : otFont
      ? `<g opacity="0.85">${textToSvgPath({
          text: handleStr,
          font: otFont,
          fontSize: handleSize,
          centerX: CANVAS_W / 2,
          centerY: subCenterY,
          fill: textBottomColor,
        })}</g>`
      : `<text x="${CANVAS_W / 2}" y="${subCenterY}" font-family="${font.family}" font-size="${handleSize}" font-weight="${font.weight}" fill="${textBottomColor}" text-anchor="middle" dominant-baseline="middle" opacity="0.85">${escapeXml(handleStr)}</text>`;

  const ctaEl = otFont
    ? textToSvgPath({
        text: cta,
        font: otFont,
        fontSize: ctaSize,
        centerX: CANVAS_W / 2,
        centerY: ctaCenterY,
        fill: textBottomColor,
        letterSpacing: isSerif ? 0 : 2,
      })
    : `<text x="${CANVAS_W / 2}" y="${ctaCenterY}" font-family="${font.family}" font-size="${ctaSize}" font-weight="${font.weight}" fill="${textBottomColor}" text-anchor="middle" dominant-baseline="middle">${escapeXml(cta)}</text>`;

  // Clip the headline + CTA glyphs to the band rectangles so any
  // residual overflow (extreme headlines that not even the 3-line
  // fallback can fit) is masked rather than visibly bleeding past
  // the band edge into the photo region. The Light theme uses a
  // semi-transparent band, so without this clip the photo behind
  // it would show overflowing text outside the band's visual mass.
  const svg = `
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="topBandClip"><rect x="0" y="${topY}" width="${CANVAS_W}" height="${topHeightPx}"/></clipPath>
    <clipPath id="bottomBandClip"><rect x="0" y="${bottomY}" width="${CANVAS_W}" height="${bottomHeightPx}"/></clipPath>
  </defs>
  <rect x="0" y="${topY}" width="${CANVAS_W}" height="${topHeightPx}" fill="${bandTopColor}" fill-opacity="${styleCfg.bandAlpha}"/>
  <rect x="0" y="${bottomY}" width="${CANVAS_W}" height="${bottomHeightPx}" fill="${bandBottomColor}" fill-opacity="${styleCfg.bandAlpha}"/>
  <g clip-path="url(#topBandClip)">${headlineTextEls}</g>
  <g clip-path="url(#bottomBandClip)">${ctaEl}${subEl}</g>
</svg>`;

  const composites: sharp.OverlayOptions[] = [
    { input: Buffer.from(svg), top: 0, left: 0 },
  ];

  if (logoBuf) {
    composites.push({
      input: logoBuf,
      top: Math.round(subCenterY - logoH / 2),
      left: Math.round((CANVAS_W - logoW) / 2),
    });
  }

  return sharp(base).composite(composites).png().toBuffer();
}
