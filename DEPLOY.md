# Deploying Content Studio

A real-estate social-media post generator. Static 4:5 Instagram posts in English, Tagalog, Spanish, and Mandarin Simplified.

## Recommended host: Vercel Pro

Vercel is the easiest match for Next.js, but **the free Hobby tier caps function runs at 10 seconds**, and AI image generation takes 15–30s. Vercel **Pro ($20/mo)** raises the cap to 60s, which is what this app needs.

Alternatives if you want a cheaper or self-hosted option:

| Host | Function timeout | Monthly cost | Notes |
|---|---|---|---|
| **Vercel Pro** | 60s | $20 | Easiest. Set env vars in dashboard, push to GitHub, done. |
| **Railway** | ~no cap | ~$5 | Node hosting, longer-running functions fine. |
| **Render** | ~no cap | $7 free tier exists | Similar to Railway. |
| **Fly.io / VPS** | unlimited | $5–10 | More work to set up. |

## Step-by-step (Vercel Pro)

### 1. Push the code to GitHub

The working directory is not yet a git repo. From a terminal in `D:\shorts and statics`:

```bash
git init
git add .
git commit -m "Initial commit"

# Create a private repo on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/content-studio.git
git branch -M main
git push -u origin main
```

`.env.local` is already in `.gitignore` so your API keys won't be committed.

### 2. Connect the repo to Vercel

1. Sign in at https://vercel.com → **Add New → Project**
2. Pick the GitHub repo you just pushed.
3. Framework preset auto-detects as **Next.js**.
4. Before clicking Deploy, click **Environment Variables** and add:

   | Key | Value |
   |---|---|
   | `PEXELS_API_KEY` | from your `.env.local` |
   | `ANTHROPIC_API_KEY` | from your `.env.local` |
   | `FAL_API_KEY` | from your `.env.local` |
   | `APP_PASSWORD` | pick something hard to guess |

5. Click **Deploy**. First deploy takes ~2 minutes.

### 3. Upgrade to Pro

If you didn't upgrade during signup, go to **Settings → Billing → Pro**. AI image generation will fail on Hobby due to the 10-second function timeout.

### 4. Visit the URL

Vercel gives you a `your-project.vercel.app` URL. Open it; the browser prompts for credentials. Username can be anything, password is whatever you set as `APP_PASSWORD`. The browser caches it for the session.

Bookmark the URL and share it (with the password) only with people who should be using it.

### 5. (Optional) Custom domain

In Vercel **Settings → Domains**, add your own domain (e.g. `content.yourbrand.com`). Vercel walks you through DNS records.

## Updating the app

Push to the `main` branch on GitHub. Vercel auto-deploys within ~30 seconds.

## Branding & assets that ship with the build

These are committed to the repo (not gitignored):

- `brand.config.ts` — colors, fonts, handle, band heights
- `public/brand/logo.png` — wordmark composited onto every post
- `public/fonts/Prata-Regular.otf` — serif headline font
- `src/lib/prompts/` — Claude voice + content-type angle lists
- `src/lib/copy.ts` — localized URLs and form-line per content type
- `src/lib/imagePrompts.ts` — 100 prompt library + per-batch seed prompts

Edit those files in the repo and push to update what ships.

## Operational notes

**API costs (rough, per 7-post batch):**
- Anthropic Claude (1 call, prompt-cached): **~$0.02–0.04**
- Pexels (5–8 photo fetches): **$0** (free tier)
- fal.ai Nano Banana 2 (2 AI images per batch): **~$0.08–0.16**
- Plus: each manual `✨ Generate` on a card adds ~$0.04–0.08 to that card.

**Claude rate limits**: Anthropic's default rate limits are well above what one user generates by hand. If you ever expand to multiple operators, request a tier upgrade in the Anthropic console.

**Logs and debugging**: Vercel **Functions → Logs** shows every API call and any errors. The Anthropic and fal request IDs are returned in error messages, which makes it easy to ping their support.

**Rotating the password**: Change `APP_PASSWORD` in Vercel env vars and redeploy. Active browser sessions will be kicked.

## Local development

```bash
npm install
cp .env.local.example .env.local
# Fill in API keys; leave APP_PASSWORD blank to skip the gate locally.
npm run dev
```

Open http://localhost:3000.
