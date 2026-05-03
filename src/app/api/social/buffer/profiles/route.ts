import { NextResponse } from "next/server";
import { getBufferProfileMap, listBufferProfiles } from "@/lib/bufferServer";

// Setup helper: returns every Buffer profile linked to the access token,
// plus the current language→platform mapping, so the user can build the
// BUFFER_PROFILE_MAP_JSON env var without hunting profile IDs in Buffer's
// dashboard. Strictly read-only.
export const runtime = "nodejs";

export async function GET() {
  try {
    const [profiles, map] = await Promise.all([
      listBufferProfiles(),
      Promise.resolve(getBufferProfileMap()),
    ]);

    const slim = profiles.map((p) => ({
      id: p.id,
      service: p.service,
      username: p.formatted_username ?? p.service_username,
      type: p.service_type,
    }));

    return NextResponse.json({
      profiles: slim,
      currentMap: map,
      hint:
        "Build BUFFER_PROFILE_MAP_JSON like " +
        '{"en":{"facebook":"<id>","instagram":"<id>","tiktok":"<id>"},"tl":{...}}.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
