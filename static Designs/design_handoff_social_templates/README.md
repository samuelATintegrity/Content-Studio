# Handoff: Agent Match Social Post Templates

## Overview

A system of **3 social post templates × 5 visual themes = 15 ready-made post variants** for Agent Match's Instagram/Facebook portrait feed (1080×1350, 4:5 aspect ratio).

The intent is to integrate this template system into the existing Agent Match publishing pipeline so a marketing user can:
1. Pick a template type (Statistic / Did You Know / Promotional)
2. Pick a theme (Light / Inverse / Halftone / Grid / Editorial)
3. Fill in copy via a form
4. Render and download the post as a 1080×1350 PNG

## About the Design Files

The files in this bundle are **design references created in HTML/JSX as a static prototype** — they show the intended look, layout, typography, and spacing of each post. They are **not production code to ship as-is**.

Your task is to **recreate these designs inside Agent Match's existing publishing system**, using its established React patterns, component library, and styling conventions. Treat the JSX in this bundle as a precise visual spec — copy the exact pixel values, font choices, and content structure — but rebuild the components in the way the rest of the codebase is structured.

Image rendering / PNG export should use whatever the existing system already uses (e.g. `html-to-image`, `satori`, Puppeteer, or a service like Bannerbear). If nothing exists yet, `html-to-image` or `satori` is the simplest path for a 1080×1350 React → PNG export.

## Fidelity

**High-fidelity.** Every value in this bundle is final and pixel-precise:
- Final colors (pure black `#000`, pure white `#fff`, neutrals `#444`, `#666`, `#999`, `#aaa`, `#ccc`)
- Final type sizes, weights, line-heights, letter-spacing
- Final spacing, padding, borders, layouts
- Final brand copy (the promotional template uses Agent Match's actual brand message)

Reproduce these exactly. The only thing that should change in production is the surrounding architecture (component file structure, prop names, how it's rendered to PNG, how form data flows in).

---

## Templates

There are **three templates**. Each template has the same five themes (described in the next section).

### Template 1 — Statistic Call-out (`StatPost`)

**Purpose:** Highlight a single eye-catching real estate / Agent Match statistic in a feed-stopping way.

**Props:**
- `theme: "light" | "inverse" | "halftone" | "grid" | "editorial"`
- `number: string` — the headline number (e.g. `"73"`, `"$58k"`, `"4.7"`)
- `unit: string` — suffix shown smaller (e.g. `"%"`, `" days"`, `"★"`)
- `statement: string` — the one-line context that gives the number meaning
- `source: string` — small attribution line (e.g. `"Industry data, 2024"`)

**Layout (top → bottom):**
1. Header row: Logo (left) · uppercase mono tag like "BY THE NUMBERS / 01" (right)
2. Eyebrow label: "── THE STAT" (uppercase mono with a leading rule)
3. Massive headline number — display sans, weight 800, font-size 360–460px, letter-spacing -0.06em, line-height 0.85. The unit is rendered ~half-size next to the number.
4. Statement — display sans 500, ~46–56px, letter-spacing -0.025em, line-height 1.1, max-width ~880px, `text-wrap: pretty`
5. Source — mono, 18px, gray (`#999` light theme, `#666` inverse)
6. Footer row: CTA button "Find Your Agent" (left) · `agentxmatch.com` (right)

### Template 2 — Did You Know? (`DYKPost`)

**Purpose:** Educational/value content. Builds trust by sharing facts about agents and the home-buying process.

**Props:**
- `theme: "light" | "inverse" | "halftone" | "grid" | "editorial"`
- `fact: string` — the headline statement (1–2 sentences max)
- `body: string` — supporting paragraph (~1–2 sentences)
- `number: string` — small index like `"01"`, `"02"`

**Layout (top → bottom):**
1. Header row: Logo · "FACT / 01" mono tag
2. Eyebrow: a black circle with a `?` glyph next to the words "Did you know?" (large, weight 600, ~36px). On the halftone theme this is replaced by a giant halftone-filled `?` with the eyebrow next to it.
3. Headline fact — display sans 700, ~70–84px, letter-spacing -0.035em, line-height 1.0–1.05, `text-wrap: balance`
4. 80×3px black rule
5. Body paragraph — sans 400, ~28–32px, letter-spacing -0.01em, line-height 1.4, color `#444` (light) / `#aaa` (inverse), `text-wrap: pretty`
6. Footer row: CTA "Get Started" · `agentxmatch.com`

### Template 3 — Promotional (`PromoPost`)

**Purpose:** Direct response. Drives traffic to agentxmatch.com to start the agent-match flow. Uses Agent Match's actual brand message (treat this copy as canonical):

> **The wrong agent can cost you tens of thousands.**
> We find the **top 10%** so you don't have to.
> *Ready to find your agent?*
> **[Get Started →]**

**Props:**
- `theme: "light" | "inverse" | "halftone" | "grid" | "editorial"`

**Layout (top → bottom):**
1. Header row: Logo · "FIND YOUR MATCH" mono tag
2. (Halftone theme only) — a halftone-filled "10%" graphic in its own zone next to the words "We match you with The top"
3. Headline — display sans 800, 104–132px, letter-spacing -0.045em, line-height 0.92–0.95, `text-wrap: balance`. The phrase **"tens of thousands"** is emphasized: italicized in some themes, underlined or pulled into a black-bg pill in others.
4. 80×3px black rule
5. Sub-line "We find the top 10% so you don't have to." — sans 500, ~44–56px, color `#444` (light) / `#aaa` (inverse). The phrase **"top 10%"** is bolded or set in an inverted black pill depending on theme.
6. Kicker: "Ready to find your agent?" — sans 600, 32–36px
7. CTA button "Get Started" (same inline pill size as the other templates — NOT full-width)
8. `agentxmatch.com` aligned right under CTA

---

## Themes (applied identically to all three templates)

All themes are pure black-and-white with at most one neutral gray. No color, no gradients, no extra brand colors.

### Theme 1 — Light (`light`)
- Background: `#fff`
- Foreground: `#000`
- Mono tags / sources: `#999`
- Body paragraph color (DYK): `#444`
- Padding: 80px on all sides
- Layout: clean editorial, header/content/footer in classic top-middle-bottom split

### Theme 2 — Inverse (`inverse`)
- Background: `#000`
- Foreground: `#fff`
- Mono tags / sources: `#666`
- Body paragraph color (DYK): `#aaa`
- Otherwise identical to Light
- Use the **white** logo (`logo-white.png`) and the inverse CTA (white pill, black text)
- Promo headline: the "tens of thousands." word is wrapped in a `#fff` block with `#000` text (a "blackbox" effect inverted)

### Theme 3 — Halftone (`halftone`)
- Background: `#fff`, foreground: `#000`
- Distinguishing element: A **large display character or number is filled with a halftone dot pattern**. Implementation uses an SVG dot pattern (`<svg width=32 height=32><rect width=32 height=32 fill=white/><circle cx=16 cy=16 r=6 fill=black/></svg>`) applied as `background-image`, with `background-clip: text` and a 3px black `-webkit-text-stroke` outlining the glyph.
- Stat halftone: the big number itself is halftone-filled
- DYK halftone: a 380px halftone `?` sits in its own zone at the top, paired with "Did you know?" text. **It does not overlap the headline.**
- Promo halftone: a 360px halftone "10%" sits in its own zone at the top with the words "We match you with / The top". **It does not overlap the headline.**

### Theme 4 — Grid (`grid`)
- Background: white grid pattern (40px squares, 1px black lines at opacity 0.18) using SVG: `<svg width=40 height=40><rect width=40 height=40 fill=white/><path d="M 40 0 L 0 0 0 40" fill=none stroke=black stroke-width=1 opacity=0.18/></svg>`
- Four crosshair markers at the corners (40×40 boxes with 2px black cross lines)
- Content lives inside three solid white card panels (header, content, footer) with a 1px black border each. **Important:** the content sits in solid white blocks — do NOT use `display: inline` with a white background, that approach causes text to clip on multi-line wraps.
- Layout uses outer `flex column` with `gap: 24px` between the three card panels

### Theme 5 — Editorial (`editorial`)
- Newspaper-inspired
- Top masthead: 3px black border-bottom under header row, plus a thin 1px rule 4px below it (double-rule effect)
- Mono volume tag in header: e.g. "VOL.05 · STATISTICS · 2026"
- Eyebrow uses a `◆` diamond glyph: "◆ THE STATISTIC"
- Stat editorial: massive number on its own line, then a 2px rule, then statement in quotes
- DYK editorial: a giant 280px display `"` quotation mark sits next to the fact text
- Promo editorial: headline gets a thick `text-decoration: underline; text-decoration-thickness: 8px; text-underline-offset: 12px;` on "tens of thousands."
- Footer: 3px black border-top above CTA row

---

## Typography

- **Display font:** `'Geist'`, weights 500/600/700/800/900
- **UI / body font:** `'Inter'`, weights 400/500/600/700
- **Mono accent font:** `'JetBrains Mono'`, weights 400/500/600

All loaded from Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

If your codebase already has a different display sans (e.g. `Geist`, `Söhne`, `GT America`, `Neue Haas Grotesk`), substitute it as long as it's a bold geometric sans capable of weight 800–900 with tight tracking. The visual character is "modern, confident, tech-forward".

### Type tokens used across templates

| Role | Font | Weight | Size (px) | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Mega number (Stat headline) | Geist | 800 | 360–460 | -0.06em | 0.85 |
| Mega number unit | Geist | 800 | 200 | -0.06em | 0.85 |
| Headline (Promo big copy) | Geist | 800 | 104–132 | -0.045em | 0.92–0.95 |
| Headline (DYK fact) | Geist | 700 | 70–84 | -0.035em | 1.0–1.05 |
| Statement (Stat, supporting) | Geist | 500 | 46–56 | -0.025em | 1.1 |
| Sub-line (Promo) | Geist | 500 | 44–56 | -0.025em | 1.1 |
| Body paragraph (DYK) | Geist/Inter | 400 | 28–32 | -0.01em | 1.4 |
| Eyebrow ("Did you know?") | Geist | 600 | 36–56 | -0.02em | 1.0 |
| Kicker ("Ready to find your agent?") | Geist | 600 | 32–36 | -0.02em | 1.0 |
| CTA button label | Geist/Inter | 600 | 22 | -0.01em | 1.0 |
| Mono tags / source | JetBrains Mono | 400–500 | 16–22 | 0.04–0.12em | 1.5 |

---

## CTA Button Spec

A pill-shaped inline button used on every post.

```css
display: inline-flex;
align-items: center;
gap: 10px;
background: #000;          /* light themes */
color: #fff;
padding: 18px 28px;
border-radius: 999px;
font-family: 'Geist', 'Inter', sans-serif;
font-weight: 600;
font-size: 22px;
letter-spacing: -0.01em;
line-height: 1;
```

Inverse variant (used on theme="inverse"): swap `background: #fff` and `color: #000`.

The label is followed by a 22×22px arrow icon: `<svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`.

The button is **inline-sized** (hugs its content) on all three templates — do not stretch it full-width.

---

## Logo Treatment

Two PNG logo assets are included:

- `logo-black.png` — for use on light backgrounds (Light, Halftone, Grid, Editorial themes)
- `logo-white.png` — for use on dark backgrounds (Inverse theme)

Both are 1536×545 (~2.82:1 ratio). Render at a height of `~67px` (size prop = 28; image height = `size * 2.4`).

```jsx
<img
  src={isInverse ? "logo-white.png" : "logo-black.png"}
  alt="Agent Match"
  style={{ height: 67, width: "auto", display: "block" }}
/>
```

Both should be available as static assets in the codebase. If your codebase uses an SVG version of the logo, that's preferable.

---

## Spacing & Frame

Every post is rendered inside a fixed **1080×1350px** frame (4:5 aspect for Instagram/Facebook portrait).

```jsx
const Frame = ({ children, bg = "#fff", color = "#000" }) => (
  <div style={{
    width: 1080,
    height: 1350,
    background: bg,
    color,
    position: "relative",
    overflow: "hidden",
  }}>
    {children}
  </div>
);
```

Internal padding is **80px** on all sides for most themes, **100px** for the Grid theme (to leave room for the corner crosshair markers, though in the final the crosshairs sit OUTSIDE the white card panels).

In the design canvas prototype this frame is `transform: scale(0.5)`'d to 540×675 for display. **Strip the transform when rendering for production / PNG export** — the export must be true 1080×1350.

---

## Patterns (SVG, used inline as background-image)

### Halftone dot pattern
```js
const halftoneBg = (fg = "#000", bg = "#fff") =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='${bg}'/><circle cx='16' cy='16' r='6' fill='${fg}'/></svg>`
  )}")`;
```

### Grid pattern
```js
const gridBg = (line = "#000", bg = "#fff", step = 40) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${step}' height='${step}'><rect width='${step}' height='${step}' fill='${bg}'/><path d='M ${step} 0 L 0 0 0 ${step}' fill='none' stroke='${line}' stroke-width='1' opacity='0.18'/></svg>`
  )}")`;
```

When a halftone-filled glyph is needed: apply the halftone background-image to the text element with `background-clip: text`, `color: transparent`, and `-webkit-text-stroke: 3px #000` so the glyph reads even where dots are sparse.

---

## State / Form Inputs Needed (for the publishing UI)

The publishing UI should expose these inputs:

- **Template** (radio): `stat` | `dyk` | `promo`
- **Theme** (radio): `light` | `inverse` | `halftone` | `grid` | `editorial`
- **(stat only)** number, unit, statement, source
- **(dyk only)** fact, body, number (auto-incrementable)
- **(promo only)** no copy inputs — copy is fixed
- **Output**: live preview (scaled) + "Download PNG @ 1080×1350" button

---

## Design Tokens Summary

```css
/* Colors */
--black: #000;
--white: #fff;
--gray-444: #444;   /* DYK body paragraph (light) */
--gray-666: #666;   /* mono source (inverse) */
--gray-999: #999;   /* mono source (light) */
--gray-aaa: #aaa;   /* DYK body paragraph (inverse) */
--gray-ccc: #ccc;   /* "swipe →" hint */

/* Spacing */
--frame-pad-default: 80px;
--frame-pad-grid: 80px outer, 24px gap between cards;
--card-pad-grid-content: 48px 40px;
--card-pad-grid-header-footer: 20px 24px;

/* Borders */
--rule-thick: 3px solid #000;        /* 80×3 accent rule */
--rule-grid-card: 1px solid #000;
--rule-editorial-bottom: 3px solid #000;
--rule-editorial-top-thin: 1px solid #000;

/* Pattern dimensions */
--halftone-tile: 32px;
--grid-tile: 40px;
--grid-line-opacity: 0.18;
```

---

## Files Included

- `Agent Match Social Templates.html` — entry HTML; loads scripts and renders the design canvas
- `posts.jsx` — shared building blocks: `Wordmark`, `CTAButton`, `Frame`, `halftoneBg`, `gridBg`
- `stat-post.jsx` — `StatPost` component (5 themes)
- `dyk-post.jsx` — `DYKPost` component (5 themes)
- `promo-post.jsx` — `PromoPost` component (5 themes)
- `design-canvas.jsx` — the prototype's pan/zoom canvas (NOT needed in production — purely a presentation layer)
- `logo-black.png`, `logo-white.png` — Agent Match wordmark in both colorways

To open the prototype locally: serve the folder with any static server (`python3 -m http.server`, `npx serve`, etc.) and open `Agent Match Social Templates.html` — opening as `file://` will fail because the JSX is loaded via `<script src>`.

---

## Implementation Checklist

- [ ] Recreate `StatPost`, `DYKPost`, `PromoPost` as native components in the codebase, prop-compatible with the spec above
- [ ] Recreate the five `theme` variants for each, matching exact pixel values from the JSX source
- [ ] Wire up the publishing UI form (template + theme + copy inputs)
- [ ] Add a PNG export at true 1080×1350 (use existing rasterizer if one exists; otherwise `html-to-image` or `satori`)
- [ ] Verify all 15 (3 × 5) variants render correctly with sample copy before shipping
- [ ] Replace the PNG logos with SVG versions if available in the codebase
