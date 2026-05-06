import { NextResponse } from "next/server";
import { getBufferProfileMap, type SocialPlatform } from "@/lib/bufferServer";
import type { Language } from "@/lib/types";

// Returns which platforms (FB / IG / TikTok / YouTube) are mapped for
// the requested language. The send-modal uses this to render only the
// channels the user has actually wired up — so a user with only
// English connected doesn't see broken Tagalog checkboxes.
export const runtime = "nodejs";

const ALL_PLATFORMS: SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const language = searchParams.get("language") as Language | null;
    if (!language) {
      return NextResponse.json({ error: "language required" }, { status: 400 });
    }
    const map = getBufferProfileMap();
    const entry = map[language] ?? {};
    const platforms: SocialPlatform[] = ALL_PLATFORMS.filter((p) => Boolean(entry[p]));
    return NextResponse.json({ language, platforms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
