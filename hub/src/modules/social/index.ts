// Module: social. Connected accounts (OAuth), the comment watcher, the public-comment list,
// composing/publishing posts, and short-lived public links to post media for the platforms.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, first, newId, now, run } from "../../lib/db";
import { HttpError, badRequest, json, notFound } from "../../lib/http";
import { isLocal } from "../../lib/session";
import { optional, parse, str } from "../../lib/validate";
import { publicAccount, upsertAccount } from "./accounts";
import { MOCK_PREFIX } from "./adapters/mock";
import { tiktokStatus } from "./adapters/tiktok";
import { verifyMediaToken } from "./mediatoken";
import {
  backToApp, bouncePage, consumeState, createState, finishGoogle, finishMeta, googleAuthUrl, googleConfigured,
  metaAuthUrl, metaConfigured, notConfigured, pruneStates, type Provider,
} from "./oauth";
import { pollAll } from "./poller";
import { publishPost, retryQueuedPosts } from "./publish";
import { AdapterError, type PostTargetRow, type SocialAccountRow, type SocialPostRow } from "./types";

export const MAX_MEDIA_BYTES = 90 * 1024 * 1024; // Cloudflare's request body limit is 100 MB on Free/Pro plans
export const MAX_CAPTION = 2200;
const MEDIA_TYPES: Record<string, string> = { "video/mp4": "mp4", "image/jpeg": "jpg", "image/png": "png" };

// ---------- accounts ----------
async function listAccounts(ctx: Ctx) {
  const rows = await all<SocialAccountRow>(ctx.env, "SELECT * FROM social_accounts WHERE status != 'disabled' ORDER BY platform, handle");
  return json({
    accounts: rows.map(publicAccount),
    providers: {
      meta: { configured: metaConfigured(ctx.env) },
      google: { configured: googleConfigured(ctx.env) },
      tiktok: { configured: false, ...tiktokStatus(ctx.env) },
      demo: { available: isLocal(ctx.env) },
    },
  });
}

async function disconnect(ctx: Ctx) {
  const row = await first<SocialAccountRow>(ctx.env, "SELECT * FROM social_accounts WHERE id = ?", ctx.params.id);
  if (!row) throw notFound("Account");
  await run(ctx.env, "UPDATE social_accounts SET status = 'disabled', token_enc = NULL, token_expires_at = NULL, updated_at = ? WHERE id = ?", now(), row.id);
  await audit(ctx.env, userOf(ctx).id, "social.account_disconnect", "social_account", row.id, { platform: row.platform, handle: row.handle });
  return json({ ok: true });
}

async function addMock(ctx: Ctx) {
  if (!isLocal(ctx.env)) return json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
  const acc = await upsertAccount(ctx.env, userOf(ctx).id, { platform: "instagram", handle: "mk_auto_demo", externalId: `${MOCK_PREFIX}demo_instagram`, token: null });
  return json({ account: publicAccount(acc) }, 201);
}

// ---------- OAuth ----------
function connectStart(provider: Provider) {
  return async (ctx: Ctx) => {
    const configured = provider === "meta" ? metaConfigured(ctx.env) : googleConfigured(ctx.env);
    if (!configured) throw notConfigured(provider);
    if (!ctx.env.ENCRYPTION_KEY) throw new HttpError(500, "not_configured", "The Hub's ENCRYPTION_KEY secret isn't set yet.");
    const state = await createState(ctx.env, userOf(ctx).id, provider);
    const to = provider === "meta" ? metaAuthUrl(ctx.env, state) : googleAuthUrl(ctx.env, state);
    return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
  };
}

function connectCallback(provider: Provider) {
  return (ctx: Ctx) => bouncePage(ctx.env, provider, ctx.url.searchParams);
}

function connectFinish(provider: Provider) {
  return async (ctx: Ctx) => {
    const p = ctx.url.searchParams;
    const user = userOf(ctx);
    const state = p.get("state") || "";
    const valid = await consumeState(ctx.env, state, user.id, provider);
    if (!valid) return backToApp(`error/${provider}-state`);
    if (p.get("error")) return backToApp(`error/${provider}-denied`);
    const code = p.get("code") || "";
    if (!code || code.length > 2048) return backToApp(`error/${provider}-code`);
    try {
      const n = provider === "meta" ? await finishMeta(ctx.env, user.id, code) : await finishGoogle(ctx.env, user.id, code);
      if (!n) return backToApp(`error/${provider}-no-accounts`);
      return backToApp(`connected/${provider}`);
    } catch (err) {
      const code = err instanceof AdapterError ? err.code : "failed";
      console.error("oauth finish", provider, err instanceof Error ? err.message : err);
      await audit(ctx.env, user.id, "social.connect_failed", "social_account", undefined, { provider, code });
      return backToApp(`error/${provider}-${code}`);
    }
  };
}

// ---------- watcher and comments ----------
async function pollNow(ctx: Ctx) {
  const r = await pollAll(ctx.env);
  await audit(ctx.env, userOf(ctx).id, "social.poll", undefined, undefined, { new_comments: r.newComments, new_leads: r.newLeads });
  return json({ accounts: r.accounts, new_comments: r.newComments, new_leads: r.newLeads, triaged: r.triaged, errors: r.errors });
}

async function listComments(ctx: Ctx) {
  const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 100));
  const rows = await all(ctx.env,
    `SELECT c.id, c.platform, c.author_name, c.author_handle, c.body, c.posted_at, c.fetched_at, c.triaged,
            a.handle AS account_handle, l.id AS lead_id, l.status AS lead_status, l.score AS lead_score
       FROM comments c JOIN social_accounts a ON a.id = c.account_id LEFT JOIN leads l ON l.comment_id = c.id
      ORDER BY COALESCE(c.posted_at, c.fetched_at) DESC LIMIT ?`, limit);
  return json({ comments: rows });
}

// ---------- posts ----------
function idList(v: unknown, field: string): string[] {
  const arr = (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map(x => String(x).trim()).filter(Boolean);
  if (arr.length > 20 || arr.some(x => !/^soc_[0-9a-z]{10,40}$/.test(x))) throw badRequest("Some fields need fixing.", { [field]: "Pick accounts from the list." });
  return [...new Set(arr)];
}

async function checkAccounts(ctx: Ctx, ids: string[]): Promise<SocialAccountRow[]> {
  const out: SocialAccountRow[] = [];
  for (const id of ids) {
    const a = await first<SocialAccountRow>(ctx.env, "SELECT * FROM social_accounts WHERE id = ? AND status != 'disabled'", id);
    if (!a) throw badRequest("Some fields need fixing.", { account_ids: "One of those accounts isn't connected any more." });
    out.push(a);
  }
  return out;
}

function sniff(head: Uint8Array): string | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "video/mp4"; // "ftyp"
  return null;
}

async function createPost(ctx: Ctx) {
  const { env, req } = ctx;
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_MEDIA_BYTES + 1024 * 1024) throw new HttpError(413, "too_large", "That file is too big. The limit is 90 MB. Export a shorter or lower-bitrate version (1080p Reels are usually well under this).");
  if (!(req.headers.get("content-type") || "").startsWith("multipart/form-data")) throw badRequest("Send the post as a form upload.");
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("The upload couldn't be read. Try again."); }
  const input = parse(
    { caption: form.get("caption") ?? "", account_ids: [...form.getAll("account_ids"), ...form.getAll("account_ids[]")] },
    { caption: optional(str({ max: MAX_CAPTION })), account_ids: idList },
  );
  if (!input.account_ids.length) throw badRequest("Some fields need fixing.", { account_ids: "Pick at least one account." });
  const accounts = await checkAccounts(ctx, input.account_ids);
  const media = form.get("media");
  if (!media || typeof media === "string") throw badRequest("Some fields need fixing.", { media: "Choose a video or photo." });
  const file = media as File;
  if (file.size > MAX_MEDIA_BYTES) throw new HttpError(413, "too_large", "That file is too big. The limit is 90 MB. Export a shorter or lower-bitrate version (1080p Reels are usually well under this).");
  if (!file.size) throw badRequest("Some fields need fixing.", { media: "That file is empty." });
  const type = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type || !(type in MEDIA_TYPES) || (file.type && file.type !== type)) {
    throw badRequest("Some fields need fixing.", { media: "Use an MP4 video or a JPEG or PNG photo." });
  }
  const id = newId("post"), t = now(), user = userOf(ctx);
  const base = (file.name || "media").replace(/\.[^.]*$/, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "media";
  const key = `social/${id}/${base}.${MEDIA_TYPES[type]}`;
  await env.FILES.put(key, file, { httpMetadata: { contentType: type } });
  await run(env, "INSERT INTO social_posts (id, caption, media_r2_key, media_type, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)",
    id, input.caption ?? "", key, type, user.id, t, t);
  for (const a of accounts) {
    await run(env, "INSERT INTO social_post_targets (id, post_id, account_id, status) VALUES (?, ?, ?, 'queued')", newId("tgt"), id, a.id);
  }
  await audit(env, user.id, "social.post_create", "social_post", id, { accounts: accounts.map(a => a.id), media_type: type, size: file.size });
  return json({ post: await loadPost(ctx, id) }, 201);
}

async function loadPost(ctx: Ctx, id: string) {
  const post = await first<SocialPostRow>(ctx.env, "SELECT * FROM social_posts WHERE id = ?", id);
  if (!post) return null;
  const targets = await all<PostTargetRow & { platform: string; handle: string }>(ctx.env,
    "SELECT t.*, a.platform, a.handle FROM social_post_targets t JOIN social_accounts a ON a.id = t.account_id WHERE t.post_id = ? ORDER BY a.platform", id);
  return { ...post, targets };
}

async function listPosts(ctx: Ctx) {
  const posts = await all<SocialPostRow>(ctx.env, "SELECT * FROM social_posts ORDER BY created_at DESC LIMIT 50");
  const targets = posts.length
    ? await all<PostTargetRow & { platform: string; handle: string }>(ctx.env,
      `SELECT t.*, a.platform, a.handle FROM social_post_targets t JOIN social_accounts a ON a.id = t.account_id
        WHERE t.post_id IN (${posts.map(() => "?").join(",")}) ORDER BY a.platform`, ...posts.map(p => p.id))
    : [];
  return json({ posts: posts.map(p => ({ ...p, targets: targets.filter(t => t.post_id === p.id) })) });
}

async function publishRoute(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const input = parse(await ctx.body(), { account_ids: idList });
  const post = await first<SocialPostRow>(env, "SELECT * FROM social_posts WHERE id = ?", ctx.params.id);
  if (!post) throw notFound("Post");
  if (post.status === "published") throw new HttpError(409, "conflict", "This post has already been published everywhere.");
  if (post.status === "publishing" && Date.parse(post.updated_at) > Date.now() - 10 * 60_000) throw new HttpError(409, "conflict", "This post is being published right now.");
  for (const a of await checkAccounts(ctx, input.account_ids)) {
    const exists = await first(env, "SELECT 1 AS x FROM social_post_targets WHERE post_id = ? AND account_id = ?", post.id, a.id);
    if (!exists) await run(env, "INSERT INTO social_post_targets (id, post_id, account_id, status) VALUES (?, ?, ?, 'queued')", newId("tgt"), post.id, a.id);
  }
  // A manual publish also retries anything that failed before.
  await run(env, "UPDATE social_post_targets SET status = 'queued', error = NULL WHERE post_id = ? AND status = 'failed'", post.id);
  const count = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM social_post_targets WHERE post_id = ?", post.id);
  if (!count?.n) throw badRequest("Some fields need fixing.", { account_ids: "Pick at least one account." });
  await audit(env, user.id, "social.post_publish", "social_post", post.id);
  await publishPost(env, post.id, user.id);
  return json({ post: await loadPost(ctx, post.id) });
}

// ---------- public media links for the platforms ----------
async function publicMedia(ctx: Ctx) {
  const { env } = ctx;
  const postId = await verifyMediaToken(env.ENCRYPTION_KEY, ctx.params.token);
  if (!postId) throw notFound("Media");
  const post = await first<{ media_r2_key: string | null; media_type: string | null }>(env, "SELECT media_r2_key, media_type FROM social_posts WHERE id = ?", postId);
  if (!post?.media_r2_key) throw notFound("Media");
  const headers = new Headers({
    "content-type": post.media_type || "application/octet-stream", "accept-ranges": "bytes",
    "cache-control": "private, max-age=300", "x-robots-tag": "noindex",
  });
  if (ctx.req.method === "HEAD") {
    const head = await env.FILES.head(post.media_r2_key);
    if (!head) throw notFound("Media");
    headers.set("content-length", String(head.size));
    return new Response(null, { status: 200, headers });
  }
  let obj: R2ObjectBody | null;
  const wantsRange = ctx.req.headers.has("range");
  try { obj = await env.FILES.get(post.media_r2_key, wantsRange ? { range: ctx.req.headers } : undefined); }
  catch { obj = await env.FILES.get(post.media_r2_key); }
  if (!obj) throw notFound("Media");
  const r = obj.range as { offset?: number; length?: number } | undefined;
  if (wantsRange && r && typeof r.offset === "number" && typeof r.length === "number" && r.length < obj.size) {
    headers.set("content-range", `bytes ${r.offset}-${r.offset + r.length - 1}/${obj.size}`);
    headers.set("content-length", String(r.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

const social: Module = {
  name: "social",
  register(r) {
    r.get("/api/social/accounts", listAccounts);
    r.post("/api/social/accounts/mock", addMock);
    r.delete("/api/social/accounts/:id", disconnect);
    for (const p of ["meta", "google"] as const) {
      r.get(`/api/social/connect/${p}/start`, connectStart(p));
      r.get(`/api/social/connect/${p}/callback`, connectCallback(p), "public"); // provider redirect; see oauth.ts
      r.get(`/api/social/connect/${p}/finish`, connectFinish(p));
    }
    r.post("/api/social/poll", pollNow);
    r.get("/api/social/comments", listComments);
    r.get("/api/social/posts", listPosts);
    r.post("/api/social/posts", createPost);
    r.post("/api/social/posts/:id/publish", publishRoute);
    r.get("/api/public/media/:token", publicMedia, "public");
    r.add("HEAD", "/api/public/media/:token", publicMedia, "public");
  },
  async scheduled(env) {
    await pruneStates(env).catch(err => console.error("oauth prune", err));
    await pollAll(env).catch(err => console.error("comment watcher", err));
    await retryQueuedPosts(env).catch(err => console.error("publish retry", err));
  },
};
export default social;
