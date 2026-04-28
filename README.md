# Content Studio

A real-estate social media post generator. Turns a few clicks into a batch of ready-to-post Instagram 4:5 images plus paragraph captions in English, Tagalog, Spanish, and Mandarin Simplified.

## What it does

1. Pick a **language** and **content type** in the left panel.
2. Click **Generate posts** (floating button, bottom-right). The app:
   - calls Anthropic Claude to draft 7–10 posts (one per "angle"),
   - generates the first 2 images via fal.ai's Nano Banana 2 (a candid family + couple, or two agents for the *Good Agents* topic, with an ethnicity hint based on language),
   - pulls the rest from Pexels stock,
   - composites everything into 1080×1350 PNGs.
3. Each card lets the operator:
   - **Hover image** → Edit (drag/zoom positioning) or Download
   - **Hover caption** → Copy
   - **🎲 Shuffle** an AI prompt idea, edit it, hit **Generate** for an AI image on that card
   - **New image / New caption / Edit text** for stock-photo refresh, copy regen, or manual text overrides
   - **Style** chip cycles Branded → Light → Sepia → Plain
   - **Fit** chip toggles Fit (whole photo, side bars) vs Fill (cover)
   - **Aa** chip swaps headline font (sans/serif)

Posts always include the language-matched URL (`agentxmatch.com/quiz`, `/tagalog`, `/spanish`, `/mandarin`) and a localized "Fill out the form to connect with an agent and lender…" line ahead of the body.

## Setup (local dev)

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:
- `PEXELS_API_KEY` — free at https://www.pexels.com/api/
- `ANTHROPIC_API_KEY` — https://console.anthropic.com/
- `FAL_API_KEY` — https://fal.ai/dashboard
- `APP_PASSWORD` — leave blank to skip the password gate locally

Run:
```bash
npm run dev
```
Open http://localhost:3000.

## Going live

See **[DEPLOY.md](./DEPLOY.md)** for step-by-step deployment to Vercel Pro (recommended), Railway, or other hosts.

The app uses HTTP Basic Auth via `middleware.ts` when `APP_PASSWORD` is set, so the public URL won't leak free API spend to whoever finds it.

## Editing what ships

| File | What's in it |
|---|---|
| [brand.config.ts](./brand.config.ts) | Colors, fonts, IG handle, band heights, style variants |
| [public/brand/logo.png](./public/brand/logo.png) | The wordmark composited onto every post |
| [public/fonts/](./public/fonts/) | Self-hosted fonts (Prata serif headline) |
| [src/lib/prompts/system.ts](./src/lib/prompts/system.ts) | Claude voice rules — voice, compliance guardrails, language notes |
| [src/lib/prompts/content-types.ts](./src/lib/prompts/content-types.ts) | Per-content-type topics, guardrails, angle lists, headline hints |
| [src/lib/copy.ts](./src/lib/copy.ts) | Per-language URLs, fixed CTAs, per-content-type form-line |
| [src/lib/imagePrompts.ts](./src/lib/imagePrompts.ts) | 100-prompt shuffle library + 2-card AI-seed prompts per batch |
| [src/lib/pexels.ts](./src/lib/pexels.ts) | Per-content-type Pexels search query tiers |
| [src/lib/fal.ts](./src/lib/fal.ts) | Nano Banana 2 wrapper + style suffix |
| [src/lib/compose.ts](./src/lib/compose.ts) | Sharp pipeline — photo placement, bands, SVG text, logo |

## Architecture

- **Next.js 16** App Router, TypeScript, Tailwind 4
- **Sharp** server-side image composition (resize, composite, tint, extract)
- **Anthropic Claude** (`claude-sonnet-4-6`) via tool use — guaranteed structured output
- **fal.ai** (`fal-ai/nano-banana-2`) for AI photo generation at 4:5 aspect
- **Pexels** for stock photo pool (~1500+ unique photos per content type via tiered queries)
- **Zustand** for in-memory batch state

API routes:
- `POST /api/generate-batch` — Claude call, returns N posts (with optional `angleKey` for single-post regen)
- `POST /api/photo` — Pexels search + dedupe by id
- `POST /api/ai-image` — Nano Banana 2 image generation
- `POST /api/compose` — Sharp pipeline, returns PNG bytes

## Costs

Per 7-post batch (rough):
- Anthropic Claude: ~$0.02–0.04
- Pexels: $0
- fal.ai (2 AI seed images): ~$0.08–0.16
- Each manual `✨ Generate` adds ~$0.04–0.08

## Roadmap

- [ ] Short-form video (9:16) format
- [ ] "Just Listed" content type with property-detail input
- [ ] Direct Instagram publishing (currently copy/paste/download)
- [ ] Saved batch history
