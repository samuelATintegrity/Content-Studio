import { NextResponse } from "next/server";
import {
  allMappedProfileIds,
  getBufferProfileMap,
  listPendingUpdates,
} from "@/lib/bufferServer";

// Lists every scheduled / queued / draft post across the configured
// Buffer profiles. The Scheduled-posts modal renders this so users can
// see their full pipeline without leaving Content Studio.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const map = getBufferProfileMap();
    const profileIds = allMappedProfileIds(map);
    if (profileIds.length === 0) {
      return NextResponse.json({ updates: [] });
    }
    const updates = await listPendingUpdates(profileIds);
    return NextResponse.json({ updates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
