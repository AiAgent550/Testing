// Connecting accounts with OAuth: Facebook Login (Instagram + Facebook Pages) and Google (YouTube).
//
// Flow:  /connect/<p>/start (user)  -> 302 to the provider with a one-time `state`
//        provider -> /connect/<p>/callback (public: the provider's redirect is cross-site, so the
//                    SameSite=Strict session cookie isn't sent). It only echoes code/state into a
//                    same-origin page that moves on to:
//        /connect/<p>/finish (user)  -> checks the state belongs to THIS signed-in user, exchanges
//                    the code, stores tokens encrypted, then 302 back to /app/#/social/connected/<p>.
import type { Env } from "../../lib/env";
import { decrypt, randomToken, sha256Hex } from "../../lib/crypto";
import { first, now, run } from "../../lib/db";
import { HttpError } from "../../lib/http";
import { graph, GRAPH_VERSION } from "./adapters/meta";
import { GOOGLE_AUTH_URL, YT_API, YT_SCOPE, googleToken } from "./adapters/youtube";
import { upsertAccount } from "./accounts";
import { AdapterError } from "./types";

export type Provider = "meta" | "google";
export const STATE_TTL_MINUTES = 10;

export const META_SCOPES = [
  "pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement", "pages_manage_posts",
  "instagram_basic", "instagram_manage_comments", "instagram_content_publish", "business_management",
];

export const metaConfigured = (env: Env) => !!(env.META_APP_ID && env.META_APP_SECRET);
export const googleConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const redirectUri = (env: Env, p: Provider) => `${env.APP_ORIGIN}/api/social/connect/${p}/callback`;

export async function createState(env: Env, userId: string, provider: Provider): Promise<string> {
  const state = randomToken(32);
  const t = Date.now();
  await run(env, "INSERT INTO oauth_states (state_hash, user_id, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    await sha256Hex(state), userId, provider, new Date(t).toISOString(), new Date(t + STATE_TTL_MINUTES * 60_000).toISOString());
  return state;
}

/** True once for a valid, unexpired state issued to this user for this provider; it is deleted either way. */
export async function consumeState(env: Env, state: string, userId: string, provider: Provider): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(state)) return false;
  const hash = await sha256Hex(state);
  const row = await first<{ user_id: string; provider: string; expires_at: string }>(env, "DELETE FROM oauth_states WHERE state_hash = ? RETURNING user_id, provider, expires_at", hash);
  return !!row && row.user_id === userId && row.provider === provider && row.expires_at > now();
}

export async function pruneStates(env: Env): Promise<void> {
  await run(env, "DELETE FROM oauth_states WHERE expires_at < ?", now());
}

export function metaAuthUrl(env: Env, state: string): string {
  const q = new URLSearchParams({
    client_id: env.META_APP_ID!, redirect_uri: redirectUri(env, "meta"), state, response_type: "code", scope: META_SCOPES.join(","),
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

export function googleAuthUrl(env: Env, state: string): string {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(env, "google"), response_type: "code", scope: YT_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

/** Code -> short-lived user token -> long-lived user token -> each Page (+ its Instagram account). */
export async function finishMeta(env: Env, userId: string, code: string): Promise<number> {
  if (!metaConfigured(env)) throw new AdapterError("not_configured", "Meta isn't set up.");
  const app = { client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET! };
  const short = await graph(env, null, "/oauth/access_token", { params: { ...app, redirect_uri: redirectUri(env, "meta"), code } });
  const long = await graph(env, null, "/oauth/access_token", { params: { ...app, grant_type: "fb_exchange_token", fb_exchange_token: String(short.access_token) } });
  const userToken = String(long.access_token || short.access_token);
  const pages = await graph(env, userToken, "/me/accounts", { params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" } });
  let connected = 0;
  for (const p of (pages.data ?? []) as Record<string, any>[]) {
    if (!p.id || !p.access_token) continue;
    // Page tokens made from a long-lived user token don't expire (until revoked or the password changes).
    const token = { access_token: String(p.access_token) };
    await upsertAccount(env, userId, { platform: "facebook", handle: String(p.name || p.id), externalId: String(p.id), token });
    connected++;
    const ig = p.instagram_business_account;
    if (ig?.id) {
      await upsertAccount(env, userId, { platform: "instagram", handle: String(ig.username || ig.id), externalId: String(ig.id), token });
      connected++;
    }
  }
  return connected;
}

/** Code -> access + refresh token -> the signed-in user's own channel. */
export async function finishGoogle(env: Env, userId: string, code: string): Promise<number> {
  const tok = await googleToken(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(env, "google") });
  const res = await fetch(`${YT_API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const body = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new AdapterError("platform", `YouTube: ${body?.error?.message || res.status}`);
  const ch = body.items?.[0];
  if (!ch?.id) throw new AdapterError("not_supported", "That Google account has no YouTube channel.");
  const existing = await first<{ token_enc: string | null }>(env, "SELECT token_enc FROM social_accounts WHERE platform = 'youtube' AND external_id = ?", ch.id);
  if (!tok.refresh_token && !existing?.token_enc) throw new AdapterError("needs_reauth", "Google didn't grant offline access. Try connecting again.");
  const token = {
    access_token: String(tok.access_token),
    refresh_token: tok.refresh_token ? String(tok.refresh_token) : undefined,
    access_expires_at: new Date(Date.now() + Number(tok.expires_in || 3600) * 1000).toISOString(),
  };
  if (!token.refresh_token && existing?.token_enc) {
    // Re-consent without a new refresh token: keep the one we already have.
    try { token.refresh_token = (JSON.parse(await decrypt(existing.token_enc, env.ENCRYPTION_KEY)) as { refresh_token?: string }).refresh_token; } catch { /* reconnect needed later */ }
  }
  await upsertAccount(env, userId, { platform: "youtube", handle: String(ch.snippet?.customUrl || ch.snippet?.title || ch.id), externalId: String(ch.id), token });
  return 1;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ENTITIES[c]);

/** Same-origin hop from the provider's redirect to the signed-in /finish route (no script: meta refresh + link). */
export function bouncePage(env: Env, provider: Provider, params: URLSearchParams): Response {
  const pick = (k: string, re: RegExp) => { const v = params.get(k) || ""; return re.test(v) ? v : ""; };
  const q = new URLSearchParams();
  const code = pick("code", /^[\w\-.~/+=#!]{1,2048}$/), state = pick("state", /^[0-9a-f]{64}$/);
  if (code) q.set("code", code);
  if (state) q.set("state", state);
  if (params.get("error")) q.set("error", (params.get("error") || "").replace(/[^\w]/g, "").slice(0, 40) || "denied");
  const to = esc(`/api/social/connect/${provider}/finish?${q}`);
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">`
    + `<meta http-equiv="refresh" content="0;url=${to}"><title>Connecting…</title></head>`
    + `<body><p>Connecting your account… <a href="${to}">Continue</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export function backToApp(result: string): Response {
  return new Response(null, { status: 302, headers: { location: `/app/#/social/${result}`, "cache-control": "no-store" } });
}

export function notConfigured(provider: Provider): HttpError {
  return provider === "meta"
    ? new HttpError(400, "not_configured", "Instagram and Facebook aren't set up yet: add the META_APP_ID and META_APP_SECRET secrets to the Hub first.")
    : new HttpError(400, "not_configured", "YouTube isn't set up yet: add the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets to the Hub first.");
}
