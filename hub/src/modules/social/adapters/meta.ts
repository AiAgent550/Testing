// Instagram (professional account via Instagram API with Facebook Login) and Facebook Pages,
// both through the Graph API on graph.facebook.com with the Page access token.
// Checked against developers.facebook.com (Oct 2026): IG comments/replies, IG content publishing,
// Page comments, /{page-id}/photos (url, caption) and /{page-id}/videos (file_url, description).
import type { Env } from "../../../lib/env";
import { toHex } from "../../../lib/crypto";
import { readToken } from "../accounts";
import { AdapterError, type CommentRow, type IncomingComment, type SocialAccountRow, type SocialAdapter, type SocialPostRow } from "../types";

/** The one place the Graph API version lives. v26.0 was released 29 July 2026 and is supported until July 2028. */
export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** How many recent posts to look at for new comments, per account and run. */
const RECENT_POSTS = 15;

type Json = Record<string, any>;

/** Graph errors -> AdapterError. 190 = bad/expired token; 10 and 200-299 = missing permission. */
export function graphError(status: number, body: unknown): AdapterError {
  const e = ((body as Json)?.error ?? {}) as Json;
  const code = Number(e.code);
  const message = String(e.error_user_msg || e.message || `Graph API error (HTTP ${status})`).slice(0, 300);
  if (code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299) || status === 401) {
    return new AdapterError("needs_reauth", `Meta refused the saved sign-in: ${message}`);
  }
  if ([4, 17, 32, 613, 80001, 80002].includes(code) || status === 429) return new AdapterError("rate_limited", `Meta rate limit: ${message}`);
  return new AdapterError("platform", `Meta: ${message}`);
}

async function appSecretProof(secret: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
}

/** One Graph API call. GET params go in the query string, POST params as a form body. */
export async function graph(
  env: Env, token: string | null, path: string,
  { method = "GET", params = {} }: { method?: "GET" | "POST"; params?: Record<string, string> } = {},
): Promise<Json> {
  const all: Record<string, string> = { ...params };
  if (token) {
    all.access_token = token;
    if (env.META_APP_SECRET) all.appsecret_proof = await appSecretProof(env.META_APP_SECRET, token);
  }
  const qs = new URLSearchParams(all);
  const url = `${GRAPH_BASE}${path}`;
  let res: Response;
  try {
    res = method === "GET"
      ? await fetch(`${url}?${qs}`)
      : await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: qs });
  } catch (err) {
    throw new AdapterError("platform", `Couldn't reach Meta (${(err as Error).message}).`);
  }
  const body = await res.json().catch(() => ({})) as Json;
  if (!res.ok || body.error) throw graphError(res.status, body);
  return body;
}

/** Graph timestamps look like 2026-10-20T09:15:02+0000. */
export function isoFrom(ts: unknown): string | null {
  if (typeof ts !== "string" || !ts) return null;
  const t = Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** GET /{ig-media-id}/comments?fields=id,text,username,timestamp,from{id,username},replies{...} */
export function parseIgComments(body: Json, mediaId: string, account: SocialAccountRow): IncomingComment[] {
  const out: IncomingComment[] = [];
  const isSelf = (c: Json) => same(c.username, account.handle) || c.from?.id === account.external_id;
  const one = (c: Json, parent: string | null): IncomingComment | null => {
    if (!c?.id || typeof c.text !== "string" || !c.text.trim()) return null;
    return {
      externalId: String(c.id), externalPostId: mediaId, parentExternalId: parent,
      authorName: c.username ?? c.from?.username ?? null, authorHandle: c.username ?? c.from?.username ?? null,
      body: c.text, postedAt: isoFrom(c.timestamp), fromSelf: isSelf(c),
    };
  };
  for (const c of (body.data ?? []) as Json[]) {
    const top = one(c, null);
    if (top) out.push(top);
    for (const r of (c.replies?.data ?? []) as Json[]) {
      const rep = one(r, String(c.id));
      if (rep) out.push(rep);
    }
  }
  return out;
}

/** GET /{page-post-id}/comments?fields=id,message,from{id,name},created_time,parent{id}&filter=stream */
export function parseFbComments(body: Json, postId: string, account: SocialAccountRow): IncomingComment[] {
  const out: IncomingComment[] = [];
  for (const c of (body.data ?? []) as Json[]) {
    if (!c?.id || typeof c.message !== "string" || !c.message.trim()) continue; // stickers/photos only
    out.push({
      externalId: String(c.id), externalPostId: postId, parentExternalId: c.parent?.id ? String(c.parent.id) : null,
      authorName: c.from?.name ?? null, authorHandle: c.from?.name ?? null,
      body: c.message, postedAt: isoFrom(c.created_time), fromSelf: c.from?.id === account.external_id,
    });
  }
  return out;
}

const newerThan = (since: string) => (c: IncomingComment) => !c.postedAt || c.postedAt > since;

async function sleep(ms: number) { await new Promise(r => setTimeout(r, ms)); }

export function metaAdapter(env: Env, opts: { pollMs?: number; maxPolls?: number } = {}): SocialAdapter {
  const pollMs = opts.pollMs ?? 5000, maxPolls = opts.maxPolls ?? 8;
  return {
    platform: "instagram",

    async listNewComments(account, sinceIso) {
      const { access_token } = await readToken(env, account);
      const out: IncomingComment[] = [];
      if (account.platform === "instagram") {
        const media = await graph(env, access_token, `/${account.external_id}/media`, { params: { fields: "id,timestamp,comments_count", limit: String(RECENT_POSTS) } });
        for (const m of (media.data ?? []) as Json[]) {
          if (!m.comments_count) continue;
          const body = await graph(env, access_token, `/${m.id}/comments`, {
            params: { fields: "id,text,username,timestamp,from{id,username},replies{id,text,username,timestamp,from{id,username}}", limit: "50" },
          });
          out.push(...parseIgComments(body, String(m.id), account));
        }
      } else if (account.platform === "facebook") {
        const posts = await graph(env, access_token, `/${account.external_id}/posts`, { params: { fields: "id,created_time", limit: String(RECENT_POSTS) } });
        for (const p of (posts.data ?? []) as Json[]) {
          const body = await graph(env, access_token, `/${p.id}/comments`, {
            params: { fields: "id,message,from{id,name},created_time,parent{id}", filter: "stream", order: "reverse_chronological", limit: "50" },
          });
          out.push(...parseFbComments(body, String(p.id), account));
        }
      } else {
        throw new AdapterError("not_supported", `The Meta adapter can't read ${account.platform} accounts.`);
      }
      return out.filter(newerThan(sinceIso));
    },

    async reply(account, comment: CommentRow, text) {
      const { access_token } = await readToken(env, account);
      // Instagram and Facebook both thread replies under the top-level comment.
      const target = comment.parent_external_id || comment.external_id;
      const path = account.platform === "instagram" ? `/${target}/replies` : `/${target}/comments`;
      const res = await graph(env, access_token, path, { method: "POST", params: { message: text } });
      if (!res.id) throw new AdapterError("platform", "Meta didn't return an id for the reply.");
      return { externalId: String(res.id) };
    },

    async publish(account, post: SocialPostRow, mediaUrl: string, resume?: string) {
      const { access_token } = await readToken(env, account);
      const isVideo = (post.media_type || "").startsWith("video/");
      if (account.platform === "instagram") {
        if (!isVideo && post.media_type !== "image/jpeg") throw new AdapterError("not_supported", "Instagram only accepts JPEG photos. Save the photo as a JPEG and try again.");
        let containerId = resume?.startsWith("container:") ? resume.slice(10) : "";
        if (!containerId) {
          const params: Record<string, string> = { caption: post.caption };
          if (isVideo) { params.media_type = "REELS"; params.video_url = mediaUrl; } else params.image_url = mediaUrl;
          const created = await graph(env, access_token, `/${account.external_id}/media`, { method: "POST", params });
          containerId = String(created.id);
        }
        if (isVideo || resume) {
          let status = "";
          for (let i = 0; i < maxPolls; i++) {
            status = String((await graph(env, access_token, `/${containerId}`, { params: { fields: "status_code" } })).status_code || "");
            if (status === "FINISHED" || status === "PUBLISHED") break;
            if (status === "ERROR" || status === "EXPIRED") throw new AdapterError("not_supported", `Instagram couldn't process the video (${status.toLowerCase()}). Check it's an MP4 (H.264, AAC) reel under 15 minutes.`);
            await sleep(pollMs);
          }
          if (status !== "FINISHED" && status !== "PUBLISHED") {
            throw new AdapterError("pending", "Instagram is still processing the video; it will be published on the next run.", `container:${containerId}`);
          }
        }
        const published = await graph(env, access_token, `/${account.external_id}/media_publish`, { method: "POST", params: { creation_id: containerId } });
        return { externalPostId: String(published.id) };
      }
      if (account.platform === "facebook") {
        const res = isVideo
          ? await graph(env, access_token, `/${account.external_id}/videos`, { method: "POST", params: { file_url: mediaUrl, description: post.caption } })
          : await graph(env, access_token, `/${account.external_id}/photos`, { method: "POST", params: { url: mediaUrl, caption: post.caption, published: "true" } });
        return { externalPostId: String(res.post_id || res.id) };
      }
      throw new AdapterError("not_supported", `Publishing to ${account.platform} isn't supported.`);
    },
  };
}
