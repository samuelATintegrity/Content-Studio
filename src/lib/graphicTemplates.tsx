// React templates for the three hand-built graphic post types. Rendered
// to PNG by next/og's ImageResponse (Satori + resvg under the hood).
// Layouts copy the JSX spec from static Designs/design_handoff_social_templates
// — exact pixel values, font choices, and content structure preserved.
//
// Light theme is the only one shipped in v1. Inverse / Halftone / Grid /
// Editorial are planned follow-ups; halftone + grid in particular need
// fallbacks because Satori doesn't support background-clip: text.

import React from "react";
import type {
  DykGraphicData,
  GraphicData,
  GraphicTemplate,
  StatGraphicData,
} from "./types";

export type LogoVariant = "black" | "white";

// Canonical promo copy. Treat as fixed brand message per the design
// spec — the whole point of the promo template is consistency.
export const PROMO_COPY = {
  headlinePart1: "The wrong agent",
  headlinePart2: "can cost you",
  headlinePart3Emphasis: "tens of thousands.",
  subPart1: "We find the ",
  subEmphasis: "top 10%",
  subPart2: " so you don't have to.",
  kicker: "Ready to find your agent?",
} as const;


// ── Shared subcomponents ────────────────────────────────────────────

// Logo — base64 data URL passed in by the route (Satori can't reliably
// reach the host's own public URL during a function invocation).
// Native asset ratio is 1536:545 (~2.82); the design spec uses
// height = size * 2.4 — Satori needs both width AND height set
// explicitly on <img> or it silently drops the element.
const LOGO_RATIO = 1536 / 545;
function Wordmark({ src, size = 28 }: { src: string; size?: number }) {
  const height = size * 2.4;
  const width = Math.round(height * LOGO_RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Agent Match" width={width} height={height} />
  );
}

// Pill-shaped CTA button used at the bottom of every template. Black
// bg / white text on light themes, inverted on dark.
function CTAButton({ label, inverse = false }: { label: string; inverse?: boolean }) {
  const bg = inverse ? "#fff" : "#000";
  const fg = inverse ? "#000" : "#fff";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: bg,
        color: fg,
        padding: "18px 28px",
        borderRadius: 999,
        fontFamily: "Geist, Inter, sans-serif",
        fontWeight: 600,
        fontSize: 22,
        letterSpacing: "-0.01em",
        lineHeight: 1,
      }}
    >
      <span>{label}</span>
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M5 12h14M13 5l7 7-7 7"
          stroke={fg}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ── Stat Light ──────────────────────────────────────────────────────

// Auto-shrink the giant stat number when the value runs long. Tuned for
// Geist-ExtraBold at 920px content width — anything over ~3 characters
// starts to crowd the gutters at the design's 380px target.
function statNumberFontSize(text: string): number {
  const len = text.length;
  if (len <= 3) return 380;
  if (len === 4) return 300;
  if (len === 5) return 240;
  return 200;
}

// Star adornment rendered as inline SVG. The bundled Geist subset
// doesn't include the U+2605 glyph, so a literal ★ character renders
// as tofu — we paint it ourselves at the same visual weight as the
// number so "4.8★" reads correctly.
function StarAdornment({ size, color = "#000" }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2l2.94 6.42L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 7.06-.85L12 2z" />
    </svg>
  );
}

export function StatPostLight({
  fields,
  logoBlackUrl,
}: {
  fields: StatGraphicData;
  logoBlackUrl: string;
}) {
  const numberFontSize = statNumberFontSize(fields.number);
  // Star unit gets rendered as SVG; everything else stays as text at a
  // proportionally smaller fontSize than the number so the unit reads
  // as a suffix rather than a peer.
  const unitText = fields.unit?.trim() ?? "";
  const isStarUnit = unitText === "★" || unitText.toLowerCase() === "stars";
  const unitFontSize = Math.round(numberFontSize * 0.5);
  const headerLabel = `BY THE NUMBERS / ${fields.index ?? "01"}`;
  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        background: "#fff",
        color: "#000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        fontFamily: "Geist, Inter, sans-serif",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark src={logoBlackUrl} size={28} />
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 18,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#999",
          }}
        >
          {headerLabel}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 20,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#000",
            marginBottom: 32,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ width: 40, height: 2, background: "#000" }} />
          {"The Stat"}
        </div>
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 800,
            fontSize: numberFontSize,
            letterSpacing: "-0.06em",
            lineHeight: 0.85,
            color: "#000",
            display: "flex",
            alignItems: "flex-start",
          }}
        >
          <span>{fields.number}</span>
          {isStarUnit ? (
            <div style={{ display: "flex", marginLeft: 8, marginTop: numberFontSize * 0.05 }}>
              <StarAdornment size={Math.round(numberFontSize * 0.55)} />
            </div>
          ) : unitText ? (
            <span style={{ fontSize: unitFontSize }}>{unitText}</span>
          ) : null}
        </div>
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 500,
            fontSize: 52,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            marginTop: 48,
            maxWidth: 880,
          }}
        >
          {fields.statement}
        </div>
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 18,
            color: "#999",
            marginTop: 32,
            letterSpacing: "0.04em",
          }}
        >
          {fields.source}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <CTAButton label="Find Your Agent" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 16,
            color: "#999",
            textAlign: "right",
            lineHeight: 1.5,
          }}
        >
          <span>agentxmatch.com</span>
        </div>
      </div>
    </div>
  );
}

// ── DYK Light ───────────────────────────────────────────────────────

export function DykPostLight({
  fields,
  logoBlackUrl,
}: {
  fields: DykGraphicData;
  logoBlackUrl: string;
}) {
  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        background: "#fff",
        color: "#000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        fontFamily: "Geist, Inter, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark src={logoBlackUrl} size={28} />
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 18,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#999",
          }}
        >
          {`FACT / ${fields.index}`}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Eyebrow row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              background: "#000",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "Geist, Inter, sans-serif",
              fontWeight: 700,
              fontSize: 36,
              lineHeight: 1,
            }}
          >
            ?
          </div>
          <div
            style={{
              fontFamily: "Geist, Inter, sans-serif",
              fontWeight: 600,
              fontSize: 36,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            Did you know?
          </div>
        </div>

        {/* Fact */}
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 700,
            fontSize: 84,
            letterSpacing: "-0.035em",
            lineHeight: 1.0,
          }}
        >
          {fields.fact}
        </div>

        {/* Rule */}
        <div style={{ width: 80, height: 3, background: "#000", marginTop: 48, marginBottom: 32 }} />

        {/* Body */}
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 400,
            fontSize: 32,
            letterSpacing: "-0.01em",
            lineHeight: 1.4,
            color: "#444",
            maxWidth: 880,
          }}
        >
          {fields.body}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <CTAButton label="Get Started" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 16,
            color: "#999",
            textAlign: "right",
            lineHeight: 1.5,
          }}
        >
          <span>agentxmatch.com</span>
        </div>
      </div>
    </div>
  );
}

// ── Promo Light ─────────────────────────────────────────────────────

export function PromoPostLight({ logoBlackUrl }: { logoBlackUrl: string }) {
  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        background: "#fff",
        color: "#000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        fontFamily: "Geist, Inter, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark src={logoBlackUrl} size={28} />
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 18,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#999",
          }}
        >
          Find your match
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 800,
            fontSize: 124,
            letterSpacing: "-0.045em",
            lineHeight: 0.95,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>{PROMO_COPY.headlinePart1}</span>
          <span>{PROMO_COPY.headlinePart2}</span>
          <span>{PROMO_COPY.headlinePart3Emphasis}</span>
        </div>
        <div style={{ width: 80, height: 3, background: "#000", marginTop: 44, marginBottom: 44 }} />
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 500,
            fontSize: 56,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            color: "#444",
            display: "flex",
            flexWrap: "wrap",
          }}
        >
          {PROMO_COPY.subPart1}
          <span style={{ fontWeight: 800, color: "#000" }}>{PROMO_COPY.subEmphasis}</span>
          {PROMO_COPY.subPart2}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Geist, Inter, sans-serif",
            fontWeight: 600,
            fontSize: 36,
            letterSpacing: "-0.02em",
            color: "#000",
            marginBottom: 24,
          }}
        >
          {PROMO_COPY.kicker}
        </div>
        <CTAButton label="Get Started" />
        <div
          style={{
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 16,
            color: "#999",
            textAlign: "right",
            lineHeight: 1.5,
            marginTop: 16,
          }}
        >
          agentxmatch.com
        </div>
      </div>
    </div>
  );
}

// ── Public dispatcher ───────────────────────────────────────────────

export function renderTemplate(args: {
  graphic: GraphicData;
  logoBlackUrl: string;
  logoWhiteUrl: string;
}): React.ReactElement {
  const { graphic, logoBlackUrl } = args;
  switch (graphic.template) {
    case "stat":
      return <StatPostLight fields={graphic} logoBlackUrl={logoBlackUrl} />;
    case "did_you_know":
      return <DykPostLight fields={graphic} logoBlackUrl={logoBlackUrl} />;
    case "promo":
      return <PromoPostLight logoBlackUrl={logoBlackUrl} />;
    case "ai_poster":
      // ai_poster is handled outside this module — fal.ai generates the
      // image, no React rendering. The compose-graphic route branches
      // on template before reaching this dispatcher.
      throw new Error("ai_poster is rendered via fal.ai, not the React renderer");
  }
}
