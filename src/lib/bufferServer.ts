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
//             "tiktok": "<channel_id>", "youtube": "<channel_id>" },
//     "tl": {...}, ... }
// Missing platform entries are silently skipped at queue time.
//
// YouTube notes:
//   • Channel only accepts video posts via the Buffer API; image posts
//     are filtered out before dispatch.
//   • YouTube requires a `title` (≤100 chars) and `categoryId`. We
//     derive the title from the first line of the post text (truncated
//     gracefully) and default the category to "22" (People & Blogs)
//     unless YOUTUBE_CATEGORY_ID overrides it. Shorts are auto-detected
//     by Buffer / YouTube from 9:16 aspect + short duration; no flag.

import type { Language } from "./types";

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube";

const ALL_PLATFORMS: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];

// Default YouTube category — "People & Blogs" (catch-all for personal /
// brand short-form). Override per-deployment via the YOUTUBE_CATEGORY_ID
// env var; the mapping is documented at
// https://developers.google.com/youtube/v3/docs/videoCategories/list.
const DEFAULT_YOUTUBE_CATEGORY_ID = "22";

function youtubeCategoryId(): string {
  return process.env.YOUTUBE_CATEGORY_ID?.trim() || DEFAULT_YOUTUBE_CATEGORY_ID;
}

// Derive a YouTube title from the post text. YT enforces ≤100 chars;
// we cap at 95 to leave headroom for any auto-appended marker. Strategy:
// take the first non-empty line, strip leading hashtags / handles, soft-
// truncate at the last word boundary inside the cap.
const YOUTUBE_TITLE_MAX = 95;

export function deriveYoutubeTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Agent Match";
  if (firstLine.length <= YOUTUBE_TITLE_MAX) return firstLine;
  const cut = firstLine.slice(0, YOUTUBE_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
}

// Escape an arbitrary string for inlining into a GraphQL document. The
// metadata blocks template strings into the query (rather than passing
// every per-platform value as a separate variable) so we need a tiny
// JSON-string-style escape for any user text we inline. Buffer's
// GraphQL parser treats this exactly like a JSON string literal.
function gqlString(value: string): string {
  return JSON.stringify(value);
}

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
  for (const platform of ALL_PLATFORMS) {
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

export type BufferAssetType = "video" | "image";

// Build the per-platform metadata block. Required fields differ per
// platform AND per asset type:
//   Video → Facebook needs type:reel, Instagram needs type:reel +
//   shouldShareToFeed:true, TikTok needs nothing, YouTube needs title
//   (required) + categoryId (required).
//   Image → Facebook needs type:post, Instagram needs type:post +
//   shouldShareToFeed:true. TikTok + YouTube don't accept image posts
//   via this API path; the createBufferUpdate layer filters those
//   targets out before this function gets called.
interface BuildMetadataOptions {
  // Inlined into `metadata: { youtube: { title: ..., categoryId: ... } }`
  // when platform === "youtube" and assetType === "video".
  youtubeTitle?: string;
}

function buildMetadataBlock(
  platform: SocialPlatform,
  assetType: BufferAssetType,
  opts: BuildMetadataOptions = {},
): string {
  if (assetType === "image") {
    switch (platform) {
      case "facebook":
        return `metadata: { facebook: { type: post } }`;
      case "instagram":
        return `metadata: { instagram: { type: post, shouldShareToFeed: true } }`;
      case "tiktok":
      case "youtube":
        // Image posting isn't supported on these platforms via the
        // Buffer GraphQL path. The queue-route layer above filters
        // these targets out for image posts before we get here.
        return ``;
    }
  }
  switch (platform) {
    case "facebook":
      return `metadata: { facebook: { type: reel } }`;
    case "instagram":
      return `metadata: { instagram: { type: reel, shouldShareToFeed: true } }`;
    case "tiktok":
      return ``;
    case "youtube": {
      const title = opts.youtubeTitle?.trim() || "Agent Match";
      const categoryId = youtubeCategoryId();
      return `metadata: { youtube: { title: ${gqlString(title)}, categoryId: ${gqlString(categoryId)} } }`;
    }
  }
}

// Buffer's createPost pipeline fetches the asset URL server-side to
// validate dimensions / aspect ratio. When that fetch hits a 5xx (R2's
// pub-r2.dev URL is rate-limited, Buffer's fetcher hiccups, etc.) the
// mutation fails with a "Failed to fetch image dimensions: Bad Gateway"
// message even though our request was perfectly valid. These errors are
// transient — retrying after a short delay almost always succeeds.
function isTransientBufferError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("bad gateway") ||
    m.includes("fetch image dimensions") ||
    m.includes("fetch video") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("timeout")
  );
}

async function createSinglePost(args: {
  channelId: string;
  platform: SocialPlatform;
  text: string;
  mediaUrl: string;
  assetType: BufferAssetType;
  thumbnailUrl?: string;
  scheduleMode: BufferScheduleMode;
  scheduledAtIso?: string;
}): Promise<CreatePostResult> {
  // Inline the enum values (mode, schedulingType, metadata.*.type) —
  // GraphQL enums can't ride over JSON variables as plain strings
  // without a typed declaration, and Buffer's per-platform metadata
  // shape varies enough that templating is cleaner than nesting four
  // optional input scalar declarations.
  const modeKeyword = args.scheduleMode === "queue" ? "addToQueue" : "customScheduled";
  const dueAtField =
    args.scheduleMode === "scheduled" && args.scheduledAtIso
      ? `, dueAt: $dueAt`
      : "";
  const dueAtDecl =
    args.scheduleMode === "scheduled" && args.scheduledAtIso
      ? `, $dueAt: DateTime!`
      : "";

  // Thumbnails only apply to video assets; image posts have no thumbnail concept.
  const includeThumb = args.assetType === "video" && Boolean(args.thumbnailUrl);
  const thumbField = includeThumb ? `, thumbnailUrl: $thumb` : "";
  const thumbDecl = includeThumb ? `, $thumb: String!` : "";

  const metadataBlock = buildMetadataBlock(args.platform, args.assetType, {
    youtubeTitle:
      args.platform === "youtube" ? deriveYoutubeTitle(args.text) : undefined,
  });
  const metadataField = metadataBlock ? `, ${metadataBlock}` : "";

  // Buffer's GraphQL accepts assets.videos[] for video posts and
  // assets.images[] for image posts. We pick the right one and inline
  // the URL via the same variable.
  const assetsField =
    args.assetType === "image"
      ? `assets: { images: [{ url: $url }] }`
      : `assets: { videos: [{ url: $url${thumbField} }] }`;

  const query = `
    mutation CreatePost($text: String!, $channelId: ChannelId!, $url: String!${thumbDecl}${dueAtDecl}) {
      createPost(input: {
        text: $text,
        channelId: $channelId,
        schedulingType: automatic,
        mode: ${modeKeyword},
        ${assetsField}${metadataField}${dueAtField}
      }) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    text: args.text,
    channelId: args.channelId,
    url: args.mediaUrl,
  };
  if (includeThumb && args.thumbnailUrl) variables.thumb = args.thumbnailUrl;
  if (args.scheduleMode === "scheduled" && args.scheduledAtIso) {
    variables.dueAt = args.scheduledAtIso;
  }

  // Retry on transient validation-fetch errors (Bad Gateway etc.).
  // Buffer's image-dimension probe occasionally fails when our R2
  // pub-r2.dev URL is briefly slow; the second attempt usually wins.
  // 3 attempts total, with a longer delay between each so transient
  // R2 / Buffer-edge issues have time to settle.
  const MAX_ATTEMPTS = 3;
  let lastError = "createPost failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await bufferGraphQL<{
        createPost: { post?: { id: string }; message?: string };
      }>(query, variables);
      if (data.createPost.post?.id) {
        return { postId: data.createPost.post.id };
      }
      lastError = data.createPost.message ?? "Buffer returned no post id";
    } catch (err) {
      lastError = err instanceof Error ? err.message : "createPost failed";
    }
    if (attempt < MAX_ATTEMPTS && isTransientBufferError(lastError)) {
      // 1.5s, then 4s — gives Buffer's image-fetch pipeline / R2's edge
      // a real window to recover before we surface the failure.
      const delayMs = attempt === 1 ? 1500 : 4000;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    break;
  }
  return { error: lastError };
}

// Fan out createPost across N channels (Buffer's GraphQL only accepts
// one channelId per mutation, unlike the old v1 REST which took
// profile_ids[]). Each target carries its platform so the per-platform
// metadata block can be set correctly (Facebook + Instagram need
// type: reel for vertical video; TikTok needs nothing extra).
export interface BufferTarget {
  profileId: string;
  platform: SocialPlatform;
}

export async function createBufferUpdate(args: {
  targets: BufferTarget[];
  text: string;
  // Exactly one of videoUrl / imageUrl must be provided. The route
  // layer enforces that before we get here; this function trusts it.
  videoUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  scheduleMode?: BufferScheduleMode;
  // Required when scheduleMode === "scheduled". ISO 8601 UTC.
  scheduledAtIso?: string;
}): Promise<{ updateIds: string[]; errors: Array<{ profileId: string; message: string }> }> {
  if (args.targets.length === 0) {
    throw new Error("createBufferUpdate: at least one target required");
  }
  if (!args.videoUrl && !args.imageUrl) {
    throw new Error("createBufferUpdate: videoUrl or imageUrl required");
  }
  if (args.videoUrl && args.imageUrl) {
    throw new Error("createBufferUpdate: pass exactly one of videoUrl / imageUrl");
  }
  const mode = args.scheduleMode ?? "queue";
  if (mode === "scheduled" && !args.scheduledAtIso) {
    throw new Error("scheduledAtIso required when scheduleMode === 'scheduled'");
  }
  const assetType: BufferAssetType = args.imageUrl ? "image" : "video";
  const mediaUrl = (args.imageUrl ?? args.videoUrl) as string;
  // TikTok and YouTube don't accept still images via the Buffer
  // GraphQL path — drop those targets when posting an image, surface
  // each as a per-target error so the UI can flag it without failing
  // the whole batch.
  const VIDEO_ONLY: SocialPlatform[] = ["tiktok", "youtube"];
  const filteredTargets =
    assetType === "image"
      ? args.targets.filter((t) => !VIDEO_ONLY.includes(t.platform))
      : args.targets;
  const skippedVideoOnly =
    assetType === "image"
      ? args.targets.filter((t) => VIDEO_ONLY.includes(t.platform))
      : [];
  const tasks = filteredTargets.map((t) =>
    createSinglePost({
      channelId: t.profileId,
      platform: t.platform,
      text: args.text,
      mediaUrl,
      assetType,
      thumbnailUrl: args.thumbnailUrl,
      scheduleMode: mode,
      scheduledAtIso: args.scheduledAtIso,
    }).then((r) => ({ ...r, channelId: t.profileId })),
  );
  const results = await Promise.all(tasks);
  const updateIds: string[] = [];
  const errors: Array<{ profileId: string; message: string }> = [];
  for (const r of results) {
    if (r.postId) updateIds.push(r.postId);
    else errors.push({ profileId: r.channelId, message: r.error ?? "unknown" });
  }
  // Surface the video-only-channel skips as soft errors so the UI can
  // flag them without failing the whole batch.
  for (const skipped of skippedVideoOnly) {
    const label = skipped.platform === "youtube" ? "YouTube" : "TikTok";
    errors.push({
      profileId: skipped.profileId,
      message: `${label} does not accept image posts via the Buffer API.`,
    });
  }
  if (updateIds.length === 0 && filteredTargets.length > 0) {
    throw new Error(
      `All ${filteredTargets.length} channels failed: ${errors.map((e) => e.message).join("; ")}`,
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
