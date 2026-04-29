import { randomUUID } from "node:crypto";
import type { JobState, JobStateName } from "./types.js";

// In-memory job store. Single instance is fine for our use case (one tenant,
// one Railway service). If we ever need persistence across redeploys, swap
// for SQLite on the worker's disk or Postgres.

const jobs = new Map<string, JobState>();

export function createJob(): JobState {
  const now = Date.now();
  const job: JobState = {
    id: randomUUID(),
    state: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function updateJob(
  id: string,
  patch: Partial<Pick<JobState, "state" | "progress" | "videoUrl" | "durationS" | "error">>,
): JobState | undefined {
  const existing = jobs.get(id);
  if (!existing) return undefined;
  const next: JobState = { ...existing, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  return next;
}

export function setState(id: string, state: JobStateName, progress = 0): JobState | undefined {
  return updateJob(id, { state, progress });
}

export function fail(id: string, message: string): JobState | undefined {
  return updateJob(id, { state: "failed", error: message });
}

// Garbage-collect old terminal jobs to keep memory bounded.
// Called from a setInterval in index.ts.
export function reapOldJobs(maxAgeMs = 1000 * 60 * 60 * 24): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff && (job.state === "ready" || job.state === "failed")) {
      jobs.delete(id);
      removed++;
    }
  }
  return removed;
}
