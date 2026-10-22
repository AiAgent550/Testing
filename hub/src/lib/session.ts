// Session cookies: random token in an HttpOnly cookie, only its SHA-256 stored server-side.
import type { Env, Session, User } from "./env";
import { first, now, run } from "./db";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "__Host-mk_session";
const SESSION_DAYS = 30;       // technicians stay signed in on their own phones
const IDLE_DAYS = 14;          // but an unused session expires sooner

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookieFlags(env: Env): string {
  // __Host- cookies must be Secure; local http dev uses a plain name via isLocal().
  return `Path=/; HttpOnly; SameSite=Strict${isLocal(env) ? "" : "; Secure"}`;
}

export const isLocal = (env: Env) => env.APP_ORIGIN.startsWith("http://localhost") || env.APP_ORIGIN.startsWith("http://127.0.0.1");
export const cookieName = (env: Env) => (isLocal(env) ? "mk_session" : SESSION_COOKIE);

export async function createSession(env: Env, userId: string, req: Request): Promise<{ token: string; cookie: string }> {
  const token = randomToken(32);
  const t = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await run(
    env,
    "INSERT INTO sessions (id_hash, user_id, mfa_ok, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, 0, ?, ?, ?, ?, ?)",
    await sha256Hex(token), userId, t, t, expires,
    req.headers.get("cf-connecting-ip") ?? null, (req.headers.get("user-agent") ?? "").slice(0, 200),
  );
  return { token, cookie: `${cookieName(env)}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(env)}` };
}

export const clearCookie = (env: Env) => `${cookieName(env)}=; Max-Age=0; ${cookieFlags(env)}`;

export async function loadSession(env: Env, req: Request): Promise<{ session: Session; user: User } | null> {
  const token = readCookie(req, cookieName(env));
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const idHash = await sha256Hex(token);
  const row = await first<Session & User & { last_seen_at: string }>(
    env,
    `SELECT s.id_hash, s.user_id, s.mfa_ok, s.expires_at, s.last_seen_at, u.id, u.email, u.name, u.totp_enabled, u.lang
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    idHash,
  );
  if (!row) return null;
  const nowMs = Date.now();
  if (Date.parse(row.expires_at) < nowMs || Date.parse(row.last_seen_at) < nowMs - IDLE_DAYS * 864e5) {
    await run(env, "DELETE FROM sessions WHERE id_hash = ?", idHash);
    return null;
  }
  // Refresh last-seen at most every 5 minutes to keep writes low.
  if (Date.parse(row.last_seen_at) < nowMs - 5 * 60_000) {
    await run(env, "UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?", now(), idHash);
  }
  return {
    session: { id_hash: row.id_hash, user_id: row.user_id, mfa_ok: row.mfa_ok, expires_at: row.expires_at },
    user: { id: row.id, email: row.email, name: row.name, totp_enabled: row.totp_enabled, lang: row.lang === "pl" ? "pl" : "en" },
  };
}
