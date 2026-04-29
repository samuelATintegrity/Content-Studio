// Download pre-made clip URLs (Seedance-animated images) into the per-job
// workdir, in parallel. Replaces the Pexels search+download flow.

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";

export interface DownloadedClip {
  filePath: string;
  sourceUrl: string;
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url} (${res.status})`);
  }
  const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(stream, createWriteStream(dest));
}

export async function downloadClips(urls: string[], outDir: string): Promise<DownloadedClip[]> {
  if (urls.length === 0) throw new Error("downloadClips: no URLs provided");
  const tasks = urls.map(async (url, i) => {
    const filePath = join(outDir, `clip-${i}.mp4`);
    await fetchToFile(url, filePath);
    return { filePath, sourceUrl: url } satisfies DownloadedClip;
  });
  return Promise.all(tasks);
}
