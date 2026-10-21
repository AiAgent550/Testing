// YouTube Data API v3 with the channel owner's Google OAuth token (scope youtube.force-ssl).
// Reading: commentThreads.list (allThreadsRelatedToChannelId, order=time, textFormat=plainText).
// Replying: comments.insert with snippet.parentId = the top-level comment id.
// Both checked against developers.google.com/youtube/v3/docs (Oct 2026).
import type { Env } from "../../../lib/env";
import { readToken, writeToken } from "../accounts";
import { AdapterError, type CommentRow, type IncomingComment, type SocialAccountRow, type SocialAdapter } from "../types";

export const YT_API = "https://www.googleapis.com/youtube/v3";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

type Json = Record<string, any>;

/** Google API errors -> AdapterError. */
export function googleError(status: number, body: unknown): AdapterError {
  // API errors: { error: { message, errors: [{ reason }] } }; token endpoint: { error: "invalid_grant", error_description }.
  const raw = (body as Json)?.error;
  const e = (typeof raw === "object" && raw ? raw : {}) as Json;
  const reason = String(e.errors?.[0]?.reason || e.status || (typeof raw === "string" ? raw : ""));
  const message = String(e.message || (body as Json)?.error_description || `Google API error (HTTP ${status})`).slice(0, 300);
  if (status === 401 || reason === "invalid_grant"
    || ["insufficientPermissions", "authError", "forbidden", "PERMISSION_DENIED"].includes(reason)) {
    return new AdapterError("needs_reauth", `Google refused the saved sign-in: ${message}`);
  }
  if (status === 429 || ["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) {
    return new AdapterError("rate_limited", `YouTube quota or rate limit: ${message}`);
  }
  return new AdapterError("platform", `YouTube: ${message}`);
}

/** Exchanges an authorization code or a refresh token at Google's token endpoint. */
export async function googleToken(env: Env, params: Record<string, string>): Promise<Json> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new AdapterError("not_configured", "Google isn't set up: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const body = await res.json().catch(() => ({})) as Json;
  if (!res.ok || body.error) throw googleError(res.status, body);
  return body;
}

/** A working access token for the account, refreshing (and saving) it when it is about to expire. */
export async function googleAccessToken(env: Env, account: SocialAccountRow, force = false): Promise<string> {
  const tok = await readToken(env, account);
  const fresh = tok.access_token && tok.access_expires_at && Date.parse(tok.access_expires_at) > Date.now() + 60_000;
  if (fresh && !force) return tok.access_token;
  if (!tok.refresh_token) throw new AdapterError("needs_reauth", "YouTube needs connecting again (no refresh token).");
  const body = await googleToken(env, { grant_type: "refresh_token", refresh_token: tok.refresh_token });
  const next = {
    access_token: String(body.access_token),
    refresh_token: body.refresh_token ? String(body.refresh_token) : tok.refresh_token,
    access_expires_at: new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString(),
  };
  await writeToken(env, account.id, next, null);
  return next.access_token;
}

async function yt(env: Env, account: SocialAccountRow, path: string, init: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<Json> {
  const url = `${YT_API}${path}?${new URLSearchParams(init.query ?? {})}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await googleAccessToken(env, account, attempt > 0);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      throw new AdapterError("platform", `Couldn't reach YouTube (${(err as Error).message}).`);
    }
    if (res.status === 401 && attempt === 0) continue; // token revoked early: refresh once and retry
    const body = await res.json().catch(() => ({})) as Json;
    if (!res.ok) throw googleError(res.status, body);
    return body;
  }
  throw new AdapterError("needs_reauth", "Google refused the saved sign-in.");
}

/** commentThreads.list response -> comments (top-level, plus any replies included in the thread). */
export function parseYtThreads(body: Json, account: SocialAccountRow): IncomingComment[] {
  const out: IncomingComment[] = [];
  const toComment = (c: Json, parent: string | null, videoId: string | null): IncomingComment | null => {
    const s = c?.snippet ?? {};
    const text = s.textOriginal ?? s.textDisplay;
    if (!c?.id || typeof text !== "string" || !text.trim()) return null;
    return {
      externalId: String(c.id), externalPostId: s.videoId ?? videoId, parentExternalId: parent,
      authorName: s.authorDisplayName ?? null, authorHandle: s.authorDisplayName ?? null,
      body: text, postedAt: s.publishedAt ? new Date(s.publishedAt).toISOString() : null,
      fromSelf: s.authorChannelId?.value === account.external_id,
    };
  };
  for (const t of (body.items ?? []) as Json[]) {
    const videoId = t.snippet?.videoId ?? null;
    const top = toComment(t.snippet?.topLevelComment, null, videoId);
    if (top) out.push(top);
    for (const r of (t.replies?.comments ?? []) as Json[]) {
      const rep = toComment(r, top?.externalId ?? null, videoId);
      if (rep) out.push(rep);
    }
  }
  return out;
}

export function youtubeAdapter(env: Env): SocialAdapter {
  return {
    platform: "youtube",
    async listNewComments(account, sinceIso) {
      const out: IncomingComment[] = [];
      let pageToken = "";
      // Newest first; stop once a page reaches comments older than `since` (max 3 pages a run to save quota).
      for (let page = 0; page < 3; page++) {
        const q: Record<string, string> = {
          part: "snippet,replies", allThreadsRelatedToChannelId: account.external_id, order: "time", maxResults: "50", textFormat: "plainText",
        };
        if (pageToken) q.pageToken = pageToken;
        const body = await yt(env, account, "/commentThreads", { query: q });
        const batch = parseYtThreads(body, account);
        out.push(...batch.filter(c => !c.postedAt || c.postedAt > sinceIso));
        const oldestTop = (body.items ?? []).at(-1)?.snippet?.topLevelComment?.snippet?.publishedAt;
        if (!body.nextPageToken || (oldestTop && new Date(oldestTop).toISOString() <= sinceIso)) break;
        pageToken = body.nextPageToken;
      }
      return out;
    },
    async reply(account, comment: CommentRow, text) {
      const parentId = comment.parent_external_id || comment.external_id;
      const res = await yt(env, account, "/comments", { method: "POST", query: { part: "snippet" }, body: { snippet: { parentId, textOriginal: text } } });
      if (!res.id) throw new AdapterError("platform", "YouTube didn't return an id for the reply.");
      return { externalId: String(res.id) };
    },
    async publish() {
      throw new AdapterError("not_supported", "Publishing to YouTube isn't supported yet. Upload the video in YouTube Studio for now.");
    },
  };
}
