// Pexels Videos search + download — fills in during Phase D.

import type { ContentType } from "./types.js";

export interface FootageClip {
  filePath: string;
  pexelsId: number;
  durationS: number;
}

export async function fetchFootage(
  _contentType: ContentType,
  _count: number,
  _outDir: string,
): Promise<FootageClip[]> {
  throw new Error("pexelsVideo.fetchFootage: not implemented yet (Phase D)");
}
