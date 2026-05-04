// Hand-built SVG renderer for the "graphic" static sub-mode. Three
// templates (stat, did_you_know, promo) all render to a 1080×1350 PNG
// using brand tokens + the same opentype-path text rendering as the
// photo composer in compose.ts (so font output is identical regardless
// of host fonts).
//
// Each template owns its own SVG layout. They share a tiny
// {headline, subline, cta} field shape — variety comes from the
// template, not from per-template field gymnastics.

import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import * as opentype from "opentype.js";
import { brand } from "../../brand.config";
import { CANVAS_W, CANVAS_H } from "./compose";
import { generateAiPoster } from "./fal";
import type { GraphicTemplate } from "./types";

// ── Font loading (sibling cache to compose.ts) ───────────────────────

const fontCache = new Map<string, opentype.Font>();

async function loadFont(family: "sans" | "serif"): Promise<opentype.Font | null> {
  const cached = fontCache.get(family);
  if (cached) return cached;
  const def = brand.fonts[family];
  if (!def.file) return null;
  const fsPath = path.join(process.cwd(), "public", def.file.replace(/^\//, ""));
  try {
    const bytes = await fs.readFile(fsPath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const font = opentype.parse(ab);
    fontCache.set(family, font);
    return font;
  } catch (e) {
    console.error(`[composeGraphic] font load failed for ${family}: ${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

// ── Text → SVG path helpers ─────────────────────────────────────────

interface TextPathArgs {
  text: string;
  font: opentype.Font;
  fontSize: number;
  centerX: number;
  centerY: number;
  fill: string;
  letterSpacing?: number;
  fillOpacity?: number;
}

function textToPath(args: TextPathArgs): string {
  const { text, font, fontSize, centerX, centerY, fill, letterSpacing = 0, fillOpacity = 1 } = args;
  if (!text) return "";
  const scale = fontSize / font.unitsPerEm;
  const chars = Array.from(text);
  const glyphs = chars.map((ch) => font.charToGlyph(ch));
  let width = 0;
  for (let i = 0; i < glyphs.length; i++) {
    width += (glyphs[i].advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) width += letterSpacing;
  }
  const ascender = font.ascender * scale;
  const descender = font.descender * scale;
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
  const opacityAttr = fillOpacity < 1 ? ` fill-opacity="${fillOpacity}"` : "";
  return `<path d="${d}" fill="${fill}"${opacityAttr}/>`;
}

function measureLine(text: string, font: opentype.Font, fontSize: number): number {
  const scale = fontSize / font.unitsPerEm;
  let w = 0;
  for (const ch of Array.from(text)) {
    const g = font.charToGlyph(ch);
    w += (g.advanceWidth ?? 0) * scale;
  }
  return w;
}

// Wrap a string into N lines fitting maxWidth at the given font size,
// breaking on word boundaries.
function wrapAt(text: string, font: opentype.Font, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureLine(candidate, font, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

// Wrap + shrink: try wrapping at baseSize; if the longest resulting line
// still overflows (e.g., a single word wider than maxWidth), drop the
// font size in 4-px steps and re-wrap until it fits or we hit minSize.
// Returns the final lines + the size that was actually used. Replaces
// the old wrapToLines to fix the case where a long single-word headline
// (or the layout's maxLines clamp dropped tail words) caused visible
// truncation in the rendered output.
function fitAndWrap(
  text: string,
  font: opentype.Font,
  baseSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; fontSize: number } {
  let size = baseSize;
  while (size >= minSize) {
    const lines = wrapAt(text, font, size, maxWidth, maxLines);
    const longest = lines.reduce((m, l) => Math.max(m, measureLine(l, font, size)), 0);
    // Also catch the case where wrapping clamped to maxLines and there
    // are still leftover words — surface as overflow so we shrink.
    const reconstructed = lines.join(" ");
    const droppedTail = reconstructed.replace(/\s+/g, " ") !== text.replace(/\s+/g, " ").trim();
    if (longest <= maxWidth && !droppedTail) {
      return { lines, fontSize: size };
    }
    size -= 4;
  }
  // Last resort at minSize — re-wrap and accept whatever we get rather
  // than returning empty.
  const lines = wrapAt(text, font, minSize, maxWidth, maxLines);
  return { lines, fontSize: minSize };
}

// Fit a string to a single line by shrinking the size until it fits.
function fitOneLine(text: string, font: opentype.Font, baseSize: number, minSize: number, maxWidth: number): number {
  const measure = (size: number): number => {
    const scale = size / font.unitsPerEm;
    let w = 0;
    for (const ch of Array.from(text)) {
      const g = font.charToGlyph(ch);
      w += (g.advanceWidth ?? 0) * scale;
    }
    return w;
  };
  let size = baseSize;
  while (size > minSize && measure(size) > maxWidth) size -= 4;
  return size;
}

// ── Brand color helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

// Logo loader — recolored to the requested fill via alpha-mask compose
// so the logo reads cleanly on any brand color.
async function loadLogoTinted(tintHex: string, maxH: number, maxW: number): Promise<{ buf: Buffer; w: number; h: number } | null> {
  const logoPath = path.join(process.cwd(), "public", brand.logo.replace(/^\//, ""));
  try {
    await fs.access(logoPath);
    const sized = await sharp(logoPath).resize({ height: maxH, width: maxW, fit: "inside" }).png().toBuffer();
    const meta = await sharp(sized).metadata();
    const w = meta.width ?? maxH;
    const h = meta.height ?? maxH;
    const c = hexToRgb(tintHex);
    const colored = await sharp({
      create: { width: w, height: h, channels: 4, background: { r: c.r, g: c.g, b: c.b, alpha: 1 } },
    })
      .composite([{ input: sized, blend: "dest-in" }])
      .png()
      .toBuffer();
    return { buf: colored, w, h };
  } catch {
    return null;
  }
}

// ── Template builders ───────────────────────────────────────────────

interface BuildArgs {
  fields: { headline: string; subline: string; cta: string };
  sansFont: opentype.Font | null;
  serifFont: opentype.Font | null;
}

interface BuildResult {
  svg: string;
  // Optional logo composite — sharp can't load images via SVG <image>
  // reliably, so logos are returned separately for the caller to mix in.
  logo?: { buf: Buffer; top: number; left: number };
}

const BAR_HEIGHT = 32; // accent bar at top edge of the canvas
const PADDING_X = 80;

// Stat callout: brand-color background, big number/value centered upper,
// short context line below, CTA bar at the bottom.
async function buildStat({ fields, sansFont, serifFont }: BuildArgs): Promise<BuildResult> {
  const bg = brand.colors.primary;
  const accent = brand.colors.accent;
  const text = brand.colors.text;
  const ctaBandY = CANVAS_H - 220;
  const ctaBandColor = brand.colors.secondary;

  const headline = fields.headline;
  const display = serifFont ?? sansFont;
  const supporting = sansFont ?? serifFont;

  let headlineEl = "";
  if (display) {
    const size = fitOneLine(headline, display, 320, 140, CANVAS_W - PADDING_X * 2);
    headlineEl = textToPath({
      text: headline,
      font: display,
      fontSize: size,
      centerX: CANVAS_W / 2,
      centerY: 470,
      fill: text,
    });
  }

  let sublineEl = "";
  if (supporting) {
    const { lines, fontSize } = fitAndWrap(fields.subline, supporting, 44, 28, CANVAS_W - PADDING_X * 2 - 80, 3);
    const lineH = fontSize * 1.35;
    const startY = 720 - ((lines.length - 1) * lineH) / 2;
    sublineEl = lines
      .map((ln, i) =>
        textToPath({
          text: ln,
          font: supporting,
          fontSize,
          centerX: CANVAS_W / 2,
          centerY: startY + i * lineH,
          fill: text,
          fillOpacity: 0.85,
        }),
      )
      .join("");
  }

  let ctaEl = "";
  if (sansFont) {
    const size = fitOneLine(fields.cta, sansFont, 64, 36, CANVAS_W - 200);
    ctaEl = textToPath({
      text: fields.cta,
      font: sansFont,
      fontSize: size,
      centerX: CANVAS_W / 2,
      centerY: ctaBandY + 220 / 2,
      fill: brand.colors.textSecondary,
      letterSpacing: 2,
    });
  }

  const svg = `
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${bg}"/>
  <rect x="0" y="0" width="${CANVAS_W}" height="${BAR_HEIGHT}" fill="${accent}"/>
  ${headlineEl}
  ${sublineEl}
  <rect x="0" y="${ctaBandY}" width="${CANVAS_W}" height="220" fill="${ctaBandColor}"/>
  ${ctaEl}
</svg>`;

  // Logo above the CTA band, centered horizontally.
  const logo = await loadLogoTinted(brand.colors.text, 64, Math.round(CANVAS_W * 0.5));
  if (!logo) return { svg };
  return {
    svg,
    logo: {
      buf: logo.buf,
      top: ctaBandY - 100 - logo.h / 2,
      left: Math.round((CANVAS_W - logo.w) / 2),
    },
  };
}

// Did-you-know: light card vibe, eyebrow row at the top, hook headline
// in the middle, supporting paragraph below, CTA bar at the bottom.
async function buildDidYouKnow({ fields, sansFont, serifFont }: BuildArgs): Promise<BuildResult> {
  const bg = "#F8F4EE"; // warm off-white
  const ink = brand.colors.primary;
  const ctaBandY = CANVAS_H - 220;
  const ctaBandColor = brand.colors.primary;

  // Eyebrow: small all-caps sans label at the top so the user
  // immediately reads "DID YOU KNOW?" framing.
  const eyebrow = "DID YOU KNOW?";
  let eyebrowEl = "";
  if (sansFont) {
    eyebrowEl = textToPath({
      text: eyebrow,
      font: sansFont,
      fontSize: 38,
      centerX: CANVAS_W / 2,
      centerY: 130,
      fill: ink,
      letterSpacing: 6,
      fillOpacity: 0.7,
    });
  }

  // Headline (the hook). Auto-wrap up to 3 lines, shrinking if needed.
  let headlineEl = "";
  const headlineFont = serifFont ?? sansFont;
  if (headlineFont) {
    const { lines, fontSize } = fitAndWrap(fields.headline, headlineFont, 96, 48, CANVAS_W - PADDING_X * 2, 3);
    const lineH = fontSize * 1.1;
    const startY = 380 - ((lines.length - 1) * lineH) / 2;
    headlineEl = lines
      .map((ln, i) =>
        textToPath({
          text: ln,
          font: headlineFont,
          fontSize,
          centerX: CANVAS_W / 2,
          centerY: startY + i * lineH,
          fill: ink,
        }),
      )
      .join("");
  }

  // Subline elaboration in sans, smaller, slightly more transparent.
  let sublineEl = "";
  if (sansFont) {
    const { lines, fontSize } = fitAndWrap(fields.subline, sansFont, 44, 28, CANVAS_W - PADDING_X * 2 - 60, 4);
    const lineH = fontSize * 1.4;
    const startY = 770 - ((lines.length - 1) * lineH) / 2;
    sublineEl = lines
      .map((ln, i) =>
        textToPath({
          text: ln,
          font: sansFont,
          fontSize,
          centerX: CANVAS_W / 2,
          centerY: startY + i * lineH,
          fill: ink,
          fillOpacity: 0.78,
        }),
      )
      .join("");
  }

  let ctaEl = "";
  if (sansFont) {
    const size = fitOneLine(fields.cta, sansFont, 64, 36, CANVAS_W - 200);
    ctaEl = textToPath({
      text: fields.cta,
      font: sansFont,
      fontSize: size,
      centerX: CANVAS_W / 2,
      centerY: ctaBandY + 220 / 2,
      fill: brand.colors.text,
      letterSpacing: 2,
    });
  }

  // Thin divider rule between eyebrow and headline.
  const divider = `<rect x="${CANVAS_W / 2 - 60}" y="180" width="120" height="3" fill="${ink}" fill-opacity="0.4"/>`;

  const svg = `
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${bg}"/>
  ${eyebrowEl}
  ${divider}
  ${headlineEl}
  ${sublineEl}
  <rect x="0" y="${ctaBandY}" width="${CANVAS_W}" height="220" fill="${ctaBandColor}"/>
  ${ctaEl}
</svg>`;

  return { svg };
}

// Promo poster: brand background, logo prominent at the top, tagline
// in the middle, sub-tagline below, CTA at the bottom.
async function buildPromo({ fields, sansFont, serifFont }: BuildArgs): Promise<BuildResult> {
  const bg = brand.colors.primary;
  const accent = brand.colors.accent;
  const text = brand.colors.text;
  const ctaBandY = CANVAS_H - 220;
  const ctaBandColor = brand.colors.secondary;

  const tagFont = serifFont ?? sansFont;
  let tagEl = "";
  if (tagFont) {
    const { lines, fontSize } = fitAndWrap(fields.headline, tagFont, 110, 56, CANVAS_W - PADDING_X * 2, 3);
    const lineH = fontSize * 1.1;
    const startY = 600 - ((lines.length - 1) * lineH) / 2;
    tagEl = lines
      .map((ln, i) =>
        textToPath({
          text: ln,
          font: tagFont,
          fontSize,
          centerX: CANVAS_W / 2,
          centerY: startY + i * lineH,
          fill: text,
        }),
      )
      .join("");
  }

  let subEl = "";
  if (sansFont) {
    const { lines, fontSize } = fitAndWrap(fields.subline, sansFont, 42, 26, CANVAS_W - PADDING_X * 2 - 60, 3);
    const lineH = fontSize * 1.4;
    const startY = 880 - ((lines.length - 1) * lineH) / 2;
    subEl = lines
      .map((ln, i) =>
        textToPath({
          text: ln,
          font: sansFont,
          fontSize,
          centerX: CANVAS_W / 2,
          centerY: startY + i * lineH,
          fill: text,
          fillOpacity: 0.82,
        }),
      )
      .join("");
  }

  let ctaEl = "";
  if (sansFont) {
    const size = fitOneLine(fields.cta, sansFont, 64, 36, CANVAS_W - 200);
    ctaEl = textToPath({
      text: fields.cta,
      font: sansFont,
      fontSize: size,
      centerX: CANVAS_W / 2,
      centerY: ctaBandY + 220 / 2,
      fill: brand.colors.textSecondary,
      letterSpacing: 2,
    });
  }

  const svg = `
<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${bg}"/>
  <rect x="0" y="0" width="${CANVAS_W}" height="${BAR_HEIGHT}" fill="${accent}"/>
  ${tagEl}
  ${subEl}
  <rect x="0" y="${ctaBandY}" width="${CANVAS_W}" height="220" fill="${ctaBandColor}"/>
  ${ctaEl}
</svg>`;

  // Big logo above the tagline.
  const logo = await loadLogoTinted(brand.colors.text, 220, Math.round(CANVAS_W * 0.7));
  if (!logo) return { svg };
  return {
    svg,
    logo: {
      buf: logo.buf,
      top: 280 - logo.h / 2,
      left: Math.round((CANVAS_W - logo.w) / 2),
    },
  };
}

// ── Public entry ────────────────────────────────────────────────────

export interface ComposeGraphicArgs {
  template: GraphicTemplate;
  headline: string;
  subline: string;
  cta: string;
}

export async function composeGraphic(args: ComposeGraphicArgs): Promise<Buffer> {
  // AI poster: Nano Banana Pro generates the entire 4:5 graphic from
  // copy + brand info + the logo as a reference image. We fetch the
  // resulting image and return its bytes (encoded as PNG by sharp).
  if (args.template === "ai_poster") {
    const logoUrl = resolvePublicLogoUrl();
    const { url } = await generateAiPoster({
      headline: args.headline,
      subline: args.subline,
      cta: args.cta,
      brandName: "Agent Match",
      primaryHex: brand.colors.primary,
      accentHex: brand.colors.accent,
      logoUrl: logoUrl ?? undefined,
    });
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`AI poster fetch failed (${res.status})`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return sharp(bytes).png().toBuffer();
  }

  const sansFont = await loadFont("sans");
  const serifFont = await loadFont("serif");
  const buildArgs: BuildArgs = {
    fields: { headline: args.headline, subline: args.subline, cta: args.cta },
    sansFont,
    serifFont,
  };

  let result: BuildResult;
  switch (args.template) {
    case "stat":
      result = await buildStat(buildArgs);
      break;
    case "did_you_know":
      result = await buildDidYouKnow(buildArgs);
      break;
    case "promo":
      result = await buildPromo(buildArgs);
      break;
  }

  // Render the SVG as a base raster, then composite the optional logo
  // on top so the logo's alpha is honored cleanly.
  const base = await sharp(Buffer.from(result.svg)).png().toBuffer();
  if (!result.logo) return base;
  return sharp(base)
    .composite([{ input: result.logo.buf, top: result.logo.top, left: result.logo.left }])
    .png()
    .toBuffer();
}

// Resolve a publicly fetchable URL for the brand logo so fal.ai can
// pull it as a reference image. Vercel exposes VERCEL_URL on every
// build; locally we fall back to NEXT_PUBLIC_SITE_URL or undefined
// (in which case the AI poster prompt drops the reference and just
// asks for typographic branding).
function resolvePublicLogoUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_URL;
  let base: string | null = null;
  if (explicit) base = explicit.replace(/\/$/, "");
  else if (vercel) base = `https://${vercel}`;
  if (!base) return null;
  const logoPath = brand.logo.startsWith("/") ? brand.logo : `/${brand.logo}`;
  return `${base}${logoPath}`;
}
