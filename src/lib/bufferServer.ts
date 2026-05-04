// Server-side helpers for Buffer's GraphQL API at https://api.buffer.com.
//
// Buffer killed the v1 REST API in 2025 — new tokens are OIDC-style
// personal keys for the GraphQL endpoint only. We migrated the entire
// integration to the new schema. Public function names + the
// BUFFER_PROFILE_MAP_JSON env var shape are preserved so the
// surrounding routes / UI didn't need a sweeping rename, but the
// values inside the map are now Buffer Channel IDs (not legacy
// Profile IDs). Re-fetch them via /api/social/buffer/profiles after
// the migration deploy.
//
// Token: generate at https://publish.buffer.com/settings/api ("New Key").
// Map shape (BUFFER_PROFILE_MAP_JSON):
//   { "en": { "facebook": "<channel_id>", "instagram": "<channel_id>",
//             "tiktok": "<channel_id>" }, "tl": {...}, ... }
// Missing platform entries are silently skipped at queue time.

import type { Language } from "./types";

export type SocialPlatform = "facebook" | "instagram" | "tiktok";

export interface BufferProfileMap {
  [language: string]: Partial<Record<SocialPlatform, string>>;
}

const BUFFER_API = "https://api.buffer.com";

export function getBufferAccessToken(): string {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN env var is not set");
  return token;
}

export function getBufferProfileMap(): BufferProfileMap {
  const raw = process.env.BUFFER_PROFILE_MAP_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as BufferProfileMap;
  } catch {
    return {};
  }
}

export function profileIdsForLanguage(
  map: BufferProfileMap,
  language: Language,
): Array<{ platform: SocialPlatform; profileId: string }> {
  const entry = map[language];
  if (!entry) return [];
  const out: Array<{ platform: SocialPlatform; profileId: string }> = [];
  for (const platform of ["facebook", "instagram", "tiktok"] as SocialPlatform[]) {
    const profileId = entry[platform];
    if (profileId) out.push({ platform, profileId });
  }
  return out;
}

export function allMappedProfileIds(map: BufferProfileMap): string[] {
  const ids: string[] = [];
  for (const lang of Object.keys(map)) {
    const entry = map[lang];
    if (!entry) continue;
    for (const platform of Object.keys(entry) as SocialPlatform[]) {
      const id = entry[platform];
      if (id) ids.push(id);
    }
  }
  return Array.from(new Set(ids));
}

// ── GraphQL transport ────────────────────────────────────────────────

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: (string | number)[] }>;
}

async function bufferGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getBufferAccessToken();
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer API ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Buffer GraphQL returned no data");
  return json.data;
}

// ── Organization (cached per process) ────────────────────────────────

let _orgIdCache: string | null = null;

export async function getOrganizationId(): Promise<string> {
  if (_orgIdCache) return _orgIdCache;
  const data = await bufferGraphQL<{ account: { organizations: Array<{ id: string }> } }>(
    `query GetOrganizations { account { organizations { id } } }`,
  );
  const org = data.account?.organizations?.[0];
  if (!org) throw new Error("No Buffer organization found for this account");
  _orgIdCache = org.id;
  return org.id;
}

// ── Channels (formerly "profiles") ───────────────────────────────────

// Slim shape returned by /api/social/buffer/profiles. Field names mirror
// the old REST shape so the existing setup-discovery route doesn't need
// to change its response contract.
export interface BufferProfile {
  id: string;
  service: string;
  service_username?: string;
  formatted_username?: string;
  service_type?: string;
}

interface RawChannel {
  id: string;
  name: string;
  displayName: string;
  service: string;
}

export async function listBufferProfiles(): Promise<BufferProfile[]> {
  const orgId = await getOrganizationId();
  const data = await bufferGraphQL<{ channels: RawChannel[] }>(
    `query GetChannels($input: ChannelsInput!) {
      channels(input: $input) { id name displayName service }
    }`,
    { input: { organizationId: orgId } },
  );
  return data.channels.map((c) => ({
    id: c.id,
    service: c.service,
    service_username: c.name,
    formatted_username: c.displayName || c.name,
  }));
}

// ── Post creation ────────────────────────────────────────────────────

// New Buffer schedule modes (subset we support):
//   "queue"     → schedulingType: automatic, mode: addToQueue
//   "scheduled" → schedulingType: automatic, mode: customScheduled, dueAt: <iso>
// The legacy "now" and "draft" v1 modes are NOT exposed by Buffer's
// GraphQL public API, so we no longer offer them in the UI.
export type BufferScheduleMode = "queue" | "scheduled";

interface CreatePostResult {
  postId?: string;
  error?: string;
}

async function createSinglePost(args: {
  channelId: string;
  text: string;
  videoUrl: string;
  thumbnailUrl?: string;
  scheduleMode: BufferScheduleMode;
  scheduledAtIso?: string;
}): Promise<CreatePostResult> {
  // Inline the enum values (mode, schedulingType) — GraphQL enums can't
  // ride over JSON variables as plain strings without a typed declaration
  // and Buffer's input shape isn't fully documented for variables.
  const modeKeyword = args.scheduleMode === "queue" ? "addToQueue" : "customScheduled";
  const dueAtField =
    args.scheduleMode === "scheduled" && args.scheduledAtIso
      ? `, dueAt: $dueAt`
      : "";
  const dueAtDecl =
    args.scheduleMode === "scheduled" && args.scheduledAtIso
      ? `, $dueAt: DateTime!`
      : "";

  const thumbField = args.thumbnailUrl ? `, thumbnailUrl: $thumb` : "";
  const thumbDecl = args.thumbnailUrl ? `, $thumb: String!` : "";

  const query = `
    mutation CreatePost($text: String!, $channelId: ChannelId!, $url: String!${thumbDecl}${dueAtDecl}) {
      createPost(input: {
        text: $text,
        channelId: $channelId,
        schedulingType: automatic,
        mode: ${modeKeyword},
        assets: { videos: [{ url: $url${thumbField} }] }${dueAtField}
      }) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    text: args.text,
    channelId: args.channelId,
    url: args.videoUrl,
  };
  if (args.thumbnailUrl) variables.thumb = args.thumbnailUrl;
  if (args.scheduleMode === "scheduled" && args.scheduledAtIso) {
    variables.dueAt = args.scheduledAtIso;
  }

  try {
    const data = await bufferGraphQL<{
      createPost: { post?: { id: string }; message?: string };
    }>(query, variables);
    if (data.createPost.post?.id) {
      return { postId: data.createPost.post.id };
    }
    return { error: data.createPost.message ?? "Buffer returned no post id" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "createPost failed" };
  }
}

// Fan out createPost across N channels (Buffer's GraphQL only accepts
// one channelId per mutation, unlike the old v1 REST which took
// profile_ids[]). Returns aggregated success + per-channel errors.
export async function createBufferUpdate(args: {
  profileIds: string[];
  text: string;
  videoUrl: string;
  thumbnailUrl?: string;
  scheduleMode?: BufferScheduleMode;
  // Required when scheduleMode === "scheduled". ISO 8601 UTC.
  scheduledAtIso?: string;
}): Promise<{ updateIds: string[]; errors: Array<{ profileId: string; message: string }> }> {
  if (args.profileIds.length === 0) {
    throw new Error("createBufferUpdate: at least one profileId required");
  }
  const mode = args.scheduleMode ?? "queue";
  if (mode === "scheduled" && !args.scheduledAtIso) {
    throw new Error("scheduledAtIso required when scheduleMode === 'scheduled'");
  }
  const tasks = args.profileIds.map((channelId) =>
    createSinglePost({
      channelId,
      text: args.text,
      videoUrl: args.videoUrl,
      thumbnailUrl: args.thumbnailUrl,
      scheduleMode: mode,
      scheduledAtIso: args.scheduledAtIso,
    }).then((r) => ({ ...r, channelId })),
  );
  const results = await Promise.all(tasks);
  const updateIds: string[] = [];
  const errors: Array<{ profileId: string; message: string }> = [];
  for (const r of results) {
    if (r.postId) updateIds.push(r.postId);
    else errors.push({ profileId: r.channelId, message: r.error ?? "unknown" });
  }
  // If every channel failed, surface that as an exception so the API
  // route returns a 500. Mixed success/failure returns ok with the
  // per-channel errors array.
  if (updateIds.length === 0) {
    throw new Error(
      `All ${args.profileIds.length} channels failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
  return { updateIds, errors };
}

// ── Pending posts (scheduled / queued) ───────────────────────────────

export interface PendingBufferUpdate {
  id: string;
  text: string;
  scheduledAtSec: number | null;
  status: string;
  service: string;
  profileId: string;
  profileUsername?: string;
  videoThumbnailUrl?: string;
}

interface RawPostNode {
  id: string;
  text: string;
  dueAt: string | null;
  status: string;
  channel: { id: string; service: string; displayName: string; name: string };
  assets?: { source?: string };
}

// List every "scheduled" post across the configured channels. The
// channelIds filter scopes results to the user's mapped channels only.
export async function listPendingUpdates(profileIds: string[]): Promise<PendingBufferUpdate[]> {
  if (profileIds.length === 0) return [];
  const orgId = await getOrganizationId();
  const data = await bufferGraphQL<{ posts: { edges: Array<{ node: RawPostNode }> } }>(
    `query GetScheduledPosts($input: PostsInput!) {
      posts(input: $input) {
        edges {
          node {
            id
            text
            dueAt
            status
            channel { id service displayName name }
            assets { source }
          }
        }
      }
    }`,
    {
      input: {
        organizationId: orgId,
        sort: [{ field: "dueAt", direction: "asc" }],
        filter: { status: ["scheduled"], channelIds: profileIds },
      },
    },
  );
  const nodes = data.posts.edges.map((e) => e.node);
  return nodes.map<PendingBufferUpdate>((n) => ({
    id: n.id,
    text: n.text ?? "",
    scheduledAtSec: n.dueAt ? Math.floor(new Date(n.dueAt).getTime() / 1000) : null,
    status: n.status ?? "scheduled",
    service: n.channel?.service ?? "",
    profileId: n.channel?.id ?? "",
    profileUsername: n.channel?.displayName || n.channel?.name,
    videoThumbnailUrl: n.assets?.source,
  }));
}

// ── Post deletion ────────────────────────────────────────────────────

export async function destroyBufferUpdate(updateId: string): Promise<void> {
  const data = await bufferGraphQL<{
    deletePost: { id?: string; message?: string };
  }>(
    `mutation DeletePost($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess { id }
        ... on MutationError { message }
      }
    }`,
    { input: { id: updateId } },
  );
  if (!data.deletePost.id) {
    throw new Error(data.deletePost.message ?? "deletePost failed");
  }
}
