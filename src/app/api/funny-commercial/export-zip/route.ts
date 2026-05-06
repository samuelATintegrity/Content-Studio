import { NextResponse } from "next/server";
import JSZip from "jszip";
import { buildFcpxml, type FcpxmlClipSpec } from "@/lib/fcpxml";
import { synthesizeNarration } from "@/lib/elevenlabs";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/funny-commercial/export-zip
//
// Body:
//   {
//     sequenceName: string,
//     language: Language,
//     timeline: Array<{
//       slotIndex: number,
//       clipUrl: string,
//       durationS: number,
//       overlayText?: string,
//       narrate?: boolean,   // when true, ElevenLabs synthesizes
//                            // overlayText and the mp3 lands in
//                            // narrations/ + on A2 of the XML.
//       voiceId?: string,    // optional voice override; falls back to
//                            // ELEVENLABS_VOICE_ID_<LANG>.
//     }>
//   }
//
// Response: an `application/zip` blob containing:
//   - timeline.xml          (Final Cut Pro 7 XML, Premiere-importable)
//   - clips/<slotIdx>-<basename>.mp4
//   - narrations/<slotIdx>.mp3   (only for narrate=true slots)
//
// The XML uses relative paths (`file://./clips/...`) so the zip is
// portable — extract anywhere and Premiere resolves siblings.

interface Body {
  sequenceName: string;
  language: Language;
  timeline: Array<{
    slotIndex: number;
    clipUrl: string;
    durationS: number;
    overlayText?: string;
    narrate?: boolean;
    voiceId?: string;
  }>;
}

function safeBaseName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "clip";
    // Strip query strings already removed; sanitize remaining junk.
    return last.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60) || "clip";
  } catch {
    return "clip";
  }
}

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${label} fetch failed: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.sequenceName?.trim()) {
      return NextResponse.json({ error: "sequenceName is required" }, { status: 400 });
    }
    if (!body.language) {
      return NextResponse.json({ error: "language is required" }, { status: 400 });
    }
    if (!Array.isArray(body.timeline) || body.timeline.length === 0) {
      return NextResponse.json({ error: "timeline (non-empty) is required" }, { status: 400 });
    }

    const zip = new JSZip();
    const clipsFolder = zip.folder("clips")!;
    const narrationsFolder = zip.folder("narrations")!;

    // Per slot, in parallel: download the clip bytes and (when
    // narrate=true) synthesize the narration mp3 inline. Narration
    // synthesis happens server-side via ElevenLabs and the bytes land
    // straight in the zip — no R2 round-trip — so the export is
    // self-contained and reproducible: rerunning produces the same
    // mp3 from the same text+voice combination.
    const clipSpecs: FcpxmlClipSpec[] = await Promise.all(
      body.timeline.map(async (slot) => {
        const baseName = safeBaseName(slot.clipUrl);
        const clipFileName = `${slot.slotIndex}-${baseName.endsWith(".mp4") ? baseName : `${baseName}.mp4`}`;

        const wantNarration =
          !!slot.narrate && !!slot.overlayText && slot.overlayText.trim().length > 0;

        const [clipBytes, narrationResult] = await Promise.all([
          fetchBytes(slot.clipUrl, `clip ${slot.slotIndex}`),
          wantNarration
            ? synthesizeNarration({
                text: slot.overlayText!.trim(),
                language: body.language,
                voiceId: slot.voiceId,
              })
                .catch((e) => {
                  // Best-effort: if a single slot's narration fails,
                  // log it and let the slot ship without narration
                  // rather than failing the whole export.
                  console.warn(
                    `[fc/export-zip] narration ${slot.slotIndex} failed:`,
                    e instanceof Error ? e.message : String(e),
                  );
                  return null;
                })
            : Promise.resolve(null),
        ]);

        clipsFolder.file(clipFileName, clipBytes);

        let narrationFileName: string | undefined;
        if (narrationResult) {
          narrationFileName = `${slot.slotIndex}.mp3`;
          narrationsFolder.file(narrationFileName, narrationResult.bytes);
        }

        return {
          slotIndex: slot.slotIndex,
          clipFileName,
          durationS: slot.durationS,
          overlayText: slot.overlayText,
          narrationFileName,
        };
      }),
    );

    const xml = buildFcpxml({
      sequenceName: body.sequenceName,
      clips: clipSpecs,
    });
    zip.file("timeline.xml", xml);

    // Tiny README so a user opening the zip knows what's what.
    zip.file(
      "README.txt",
      [
        `${body.sequenceName} — Funny Commercial export`,
        "",
        "Open `timeline.xml` in Premiere Pro CC (File → Import).",
        "It loads as a 9:16 sequence with V1 clip track, V2 title overlays, and A1/A2 audio tracks.",
        "All clip references are relative — extract this zip anywhere and the paths resolve.",
        "",
        "Generated by Content Studio.",
      ].join("\n"),
    );

    const out = await zip.generateAsync({ type: "nodebuffer" });
    return new Response(out as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="funny-commercial-${Date.now()}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
