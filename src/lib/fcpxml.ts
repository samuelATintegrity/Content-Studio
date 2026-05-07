// Final Cut Pro 7 XML serializer for the Story Builder Premiere export.
//
// Premiere Pro CC reliably imports FCP7 XML (the legacy "xmeml" dialect)
// as a multi-track sequence. Newer .fcpxml is FCP X-only and trips up
// Premiere. We generate one <sequence> per export with:
//   - V1: per-slot video clips referenced by RELATIVE path (so the zip
//     is portable — extract anywhere, Premiere resolves siblings)
//   - A1: per-slot audio (concat of clip audio)
//
// V2 title overlays + A2 narration tracks were dropped along with the
// FC flow — story exports are now raw clip sequences.
//
// Time math is in frames. Internal sequencing assumes 30fps to match
// the worker's render output.

const FPS = 30;
const FRAME_DURATION = 100;          // ticks per frame in xmeml's 30fps grid
const TIMEBASE = 30;
const NTSC = "FALSE";

const SEQUENCE_W = 1080;
const SEQUENCE_H = 1920;
const SAMPLE_RATE = 44100;

export interface FcpxmlClipSpec {
  // 1-based index used in clip names. Stable across re-exports.
  slotIndex: number;
  // Filename inside the zip's clips/ directory, e.g. "1-story-shot-abc.mp4".
  clipFileName: string;
  // Slot duration in seconds.
  durationS: number;
}

export interface FcpxmlExportSpec {
  sequenceName: string;          // user-visible label inside Premiere
  clips: FcpxmlClipSpec[];
  // Optional logo bumper appended at the end. Same shape as a clip.
  outro?: { clipFileName: string; durationS: number } | null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function frames(durS: number): number {
  return Math.max(1, Math.round(durS * FPS));
}

// FCP7 XML expects pathurl in `file://./relative/path.mp4` form for
// portable references. The user can extract the zip anywhere and
// Premiere will resolve clips as siblings of the .xml.
function pathurl(relPath: string): string {
  return `file://./${relPath}`;
}

function videoClipItem(args: {
  id: string;
  name: string;
  start: number;
  end: number;
  inFrames: number;
  outFrames: number;
  fileId: string;
  pathRel: string;
  totalFrames: number;
  hasAudio: boolean;
}): string {
  return [
    `<clipitem id="${args.id}">`,
    `<name>${escapeXml(args.name)}</name>`,
    `<duration>${args.outFrames - args.inFrames}</duration>`,
    `<rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate>`,
    `<start>${args.start}</start>`,
    `<end>${args.end}</end>`,
    `<in>${args.inFrames}</in>`,
    `<out>${args.outFrames}</out>`,
    `<file id="${args.fileId}">`,
    `<name>${escapeXml(args.name)}</name>`,
    `<pathurl>${escapeXml(pathurl(args.pathRel))}</pathurl>`,
    `<rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate>`,
    `<duration>${args.totalFrames}</duration>`,
    `<media>`,
    `<video><samplecharacteristics><width>${SEQUENCE_W}</width><height>${SEQUENCE_H}</height></samplecharacteristics></video>`,
    args.hasAudio
      ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${SAMPLE_RATE}</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>`
      : "",
    `</media>`,
    `</file>`,
    `</clipitem>`,
  ]
    .filter(Boolean)
    .join("");
}

function audioClipItem(args: {
  id: string;
  name: string;
  start: number;
  end: number;
  inFrames: number;
  outFrames: number;
  fileRef: string;       // either inline file or `<file id="X" />` ref
  trackIndex: number;
}): string {
  return [
    `<clipitem id="${args.id}">`,
    `<name>${escapeXml(args.name)}</name>`,
    `<duration>${args.outFrames - args.inFrames}</duration>`,
    `<rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate>`,
    `<start>${args.start}</start>`,
    `<end>${args.end}</end>`,
    `<in>${args.inFrames}</in>`,
    `<out>${args.outFrames}</out>`,
    args.fileRef,
    `<sourcetrack><mediatype>audio</mediatype><trackindex>${args.trackIndex}</trackindex></sourcetrack>`,
    `</clipitem>`,
  ].join("");
}

export function buildFcpxml(spec: FcpxmlExportSpec): string {
  // Walk the clips, accumulating frame offsets. Build per-track lists
  // (V1, A1) as we go.
  const v1: string[] = [];
  const a1: string[] = [];

  let cursor = 0;
  let nextId = 1;
  const id = () => `cs-${nextId++}`;

  for (const clip of spec.clips) {
    const dur = frames(clip.durationS);
    const start = cursor;
    const end = cursor + dur;
    const fileId = `file-${clip.slotIndex}`;
    const clipName = `slot-${clip.slotIndex}`;
    const relPath = `clips/${clip.clipFileName}`;

    v1.push(
      videoClipItem({
        id: id(),
        name: clipName,
        start,
        end,
        inFrames: 0,
        outFrames: dur,
        fileId,
        pathRel: relPath,
        totalFrames: dur,
        hasAudio: true,
      }),
    );
    a1.push(
      audioClipItem({
        id: id(),
        name: `${clipName}-a`,
        start,
        end,
        inFrames: 0,
        outFrames: dur,
        fileRef: `<file id="${fileId}" />`,
        trackIndex: 1,
      }),
    );

    cursor = end;
  }

  if (spec.outro) {
    const dur = frames(spec.outro.durationS);
    const start = cursor;
    const end = cursor + dur;
    const fileId = "file-outro";
    const relPath = `clips/${spec.outro.clipFileName}`;
    v1.push(
      videoClipItem({
        id: id(),
        name: "outro",
        start,
        end,
        inFrames: 0,
        outFrames: dur,
        fileId,
        pathRel: relPath,
        totalFrames: dur,
        hasAudio: false,
      }),
    );
    cursor = end;
  }

  const totalFrames = cursor;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="5">`,
    `<sequence>`,
    `<name>${escapeXml(spec.sequenceName)}</name>`,
    `<duration>${totalFrames}</duration>`,
    `<rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate>`,
    `<media>`,
    `<video>`,
    `<format><samplecharacteristics><width>${SEQUENCE_W}</width><height>${SEQUENCE_H}</height><pixelaspectratio>square</pixelaspectratio><rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate><codec><name>Apple ProRes 422</name></codec></samplecharacteristics></format>`,
    `<track>${v1.join("")}</track>`,
    `</video>`,
    `<audio>`,
    `<format><samplecharacteristics><depth>16</depth><samplerate>${SAMPLE_RATE}</samplerate></samplecharacteristics></format>`,
    `<track>${a1.join("")}</track>`,
    `</audio>`,
    `</media>`,
    `<timecode><rate><timebase>${TIMEBASE}</timebase><ntsc>${NTSC}</ntsc></rate><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
    `</sequence>`,
    `</xmeml>`,
  ].join("\n");
}

// Frame-duration helper for callers that need it. Exported for test use.
export const FCPXML_FRAME_DURATION = FRAME_DURATION;
