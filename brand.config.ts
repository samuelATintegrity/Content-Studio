// Single source of truth for branding. Edit this file to swap logo, colors, fonts, handle.
// Logo path is relative to /public.

export const brand = {
  logo: "/brand/logo.png",
  handle: "@yourhandle",
  colors: {
    primary: "#0B2545",      // top band background
    secondary: "#13315C",    // bottom band background
    text: "#FFFFFF",         // text on top band
    textSecondary: "#FFFFFF",// text on bottom band
    accent: "#EEF4ED",       // optional accent stripe / underline
  },
  fonts: {
    // Both variants embed a real font file via @font-face base64 inside the SVG
    // so the compose output is identical regardless of what fonts the host
    // server has installed (Vercel's serverless container is sparse on fonts).
    sans: {
      family: "Inter",
      weight: 800,
      file: "/fonts/Inter-Bold.ttf",
    },
    serif: {
      family: "Prata",
      weight: 400,
      file: "/fonts/Prata-Regular.otf",
    },
  },
  bands: {
    topHeightPx: 220,        // 1080x1350 canvas
    bottomHeightPx: 220,
  },
  // Probability (0..1) that a post uses the serif variant. Sans is the workhorse.
  serifChance: 0.4,

  // Style variants. The "branded" style uses brand.colors above; the others swap
  // band colors, text colors, and apply a treatment to the photo.
  styles: {
    branded: {
      bandTop: null as string | null,
      bandBottom: null as string | null,
      bandAlpha: 1,
      textTop: null as string | null,
      textBottom: null as string | null,
      photoOverlay: null as null | { r: number; g: number; b: number; alpha: number },
      photoTint: null as string | null,
      photoSaturation: 1,
      logoTint: null as string | null,
      // false = photo only fills middle band-region; true = photo fills full canvas
      // and the bands sit on top as (possibly translucent) overlays.
      fullBleed: false,
    },
    light: {
      bandTop: "#FFFFFF",
      bandBottom: "#FFFFFF",
      bandAlpha: 0.5,
      textTop: "#3E2A1A",
      textBottom: "#3E2A1A",
      photoOverlay: null as null | { r: number; g: number; b: number; alpha: number },
      photoTint: null as string | null,
      photoSaturation: 1,
      logoTint: "#3E2A1A",
      fullBleed: true,
    },
    sepia: {
      bandTop: "#5C3A1E",
      bandBottom: "#5C3A1E",
      bandAlpha: 1,
      textTop: "#FFFFFF",
      textBottom: "#FFFFFF",
      photoOverlay: null as null | { r: number; g: number; b: number; alpha: number },
      photoTint: "#704414",
      photoSaturation: 0.35,
      logoTint: null as string | null,
      fullBleed: false,
    },
    // Plain: just the photo, no bands, no text, no logo. Caption does all the talking.
    plain: {
      bandTop: null as string | null,
      bandBottom: null as string | null,
      bandAlpha: 0,
      textTop: null as string | null,
      textBottom: null as string | null,
      photoOverlay: null as null | { r: number; g: number; b: number; alpha: number },
      photoTint: null as string | null,
      photoSaturation: 1,
      logoTint: null as string | null,
      fullBleed: true,
    },
  },
} as const;

export type Brand = typeof brand;
export type FontVariant = "sans" | "serif";
