import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's automatic file-tracing doesn't pick up assets read via fs.readFile
  // from /public, so on Vercel the static-post compose route was failing to
  // load Inter-Bold.ttf / Prata-Regular.otf and the SVG would render every
  // glyph as tofu. Explicitly include them in the trace for the routes that
  // do server-side image composition.
  outputFileTracingIncludes: {
    "/api/compose": ["./public/fonts/**", "./public/brand/**"],
  },
};

export default nextConfig;
