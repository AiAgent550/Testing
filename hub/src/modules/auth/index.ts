// Sign-in: email + password, then a 6-digit code from an authenticator app (required for every user).
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { decrypt, encrypt, hashPassword, newTotpSecret, otpauthUri, verifyPassword, verifyTotp } from "../../lib/crypto";
import { first, now, run } from "../../lib/db";
import { HttpError, badRequest, clientIp, conflict, forbidden, json, unauthorized } from "../../lib/http";
import { guard, record } from "../../lib/ratelimit";
import { clearCookie, createSession } from "../../lib/session";
import { email, parse, str } from "../../lib/validate";

// A real-looking hash to compare against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

interface UserRow { id: string; email: string; name: string; password_hash: string; totp_secret_enc: string | null; totp_enabled: number }

async function login(ctx: Ctx) {
  const { req, env } = ctx;
  const origin = req.headers.get("origin");
  if (origin && origin !== env.APP_ORIGIN && origin !== new URL(req.url).origin) throw forbidden();
  const input = parse(await ctx.body(), { email: email(), password: str({ max: 200 }) });
  const ip = clientIp(req);
  await guard(env, "password", input.email, 5, 15);
  await guard(env, "password_ip", ip, 20, 15);

  const user = await first<UserRow>(env, "SELECT * FROM users WHERE email = ?", input.email);
  const ok = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
  await record(env, "password", input.email, ok && !!user);
  await record(env, "password_ip", ip, ok && !!user);
  if (!user || !ok) throw unauthorized("Email or password is incorrect.");

  const { cookie } = await createSession(env, user.id, req);
  await audit(env, user.id, "auth.password_ok", "user", user.id, { ip });
  return json({ next: user.totp_enabled ? "totp" : "setup" }, 200, { "set-cookie": cookie });
}

async function totpSetup(ctx: Ctx) {
  const { env } = ctx;
  const u = userOf(ctx);
  const row = await first<UserRow>(env, "SELECT * FROM users WHERE id = ?", u.id);
  if (!row) throw unauthorized();
  if (row.totp_enabled) throw conflict("Two-step verification is already set up.");
  if (!env.ENCRYPTION_KEY) throw new HttpError(500, "not_configured", "The Hub's ENCRYPTION_KEY secret isn't set yet.");
  let secret: string;
  if (row.totp_secret_enc) secret = await decrypt(row.totp_secret_enc, env.ENCRYPTION_KEY);
  else {
    secret = newTotpSecret();
    await run(env, "UPDATE users SET totp_secret_enc = ?, updated_at = ? WHERE id = ?", await encrypt(secret, env.ENCRYPTION_KEY), now(), u.id);
  }
  return json({ secret, otpauth: otpauthUri(secret, row.email, env.BUSINESS_NAME) });
}

async function totpVerify(ctx: Ctx) {
  const { env } = ctx;
  const u = userOf(ctx);
  const { code } = parse(await ctx.body(), { code: str({ max: 6 }) });
  await guard(env, "totp", u.id, 5, 15);
  const row = await first<UserRow>(env, "SELECT * FROM users WHERE id = ?", u.id);
  if (!row?.totp_secret_enc) throw badRequest("Set up two-step verification first.");
  const ok = await verifyTotp(await decrypt(row.totp_secret_enc, env.ENCRYPTION_KEY), code.replace(/\s/g, ""));
  await record(env, "totp", u.id, ok);
  if (!ok) throw unauthorized("That code didn't match. Check the time on your phone and try the newest code.");
  if (!row.totp_enabled) {
    await run(env, "UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?", now(), u.id);
    await audit(env, u.id, "auth.totp_enabled", "user", u.id);
  }
  await run(env, "UPDATE sessions SET mfa_ok = 1 WHERE id_hash = ?", ctx.session!.id_hash);
  await audit(env, u.id, "auth.signed_in", "user", u.id, { ip: clientIp(ctx.req) });
  return json({ ok: true });
}

async function me(ctx: Ctx) {
  const u = userOf(ctx);
  return json({ user: { id: u.id, name: u.name, email: u.email }, mfa_ok: !!ctx.session?.mfa_ok, totp_enabled: !!u.totp_enabled });
}

async function logout(ctx: Ctx) {
  await run(ctx.env, "DELETE FROM sessions WHERE id_hash = ?", ctx.session!.id_hash);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(ctx.env) });
}

async function logoutEverywhere(ctx: Ctx) {
  const u = userOf(ctx);
  await run(ctx.env, "DELETE FROM sessions WHERE user_id = ?", u.id);
  await audit(ctx.env, u.id, "auth.signed_out_everywhere", "user", u.id);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(ctx.env) });
}

async function changePassword(ctx: Ctx) {
  const { env } = ctx;
  const u = userOf(ctx);
  const input = parse(await ctx.body(), { current: str({ max: 200 }), next: str({ min: 12, max: 200 }) });
  const row = await first<UserRow>(env, "SELECT * FROM users WHERE id = ?", u.id);
  if (!row || !(await verifyPassword(input.current, row.password_hash))) throw badRequest("Current password is incorrect.", { current: "Incorrect." });
  await run(env, "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(input.next), now(), u.id);
  await run(env, "DELETE FROM sessions WHERE user_id = ? AND id_hash != ?", u.id, ctx.session!.id_hash);
  await audit(env, u.id, "auth.password_changed", "user", u.id);
  return json({ ok: true });
}

async function listSessions(ctx: Ctx) {
  const rows = await ctx.env.DB.prepare(
    "SELECT substr(id_hash, 1, 12) AS id, created_at, last_seen_at, ip, user_agent, id_hash = ? AS current FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
  ).bind(ctx.session!.id_hash, userOf(ctx).id).all();
  return json({ sessions: rows.results });
}

const auth: Module = {
  name: "auth",
  register(r) {
    r.post("/api/auth/login", login, "public");
    r.get("/api/auth/totp/setup", totpSetup, "pending");
    r.post("/api/auth/totp", totpVerify, "pending");
    r.get("/api/auth/me", me, "pending");
    r.post("/api/auth/logout", logout, "pending");
    r.post("/api/auth/logout-everywhere", logoutEverywhere);
    r.post("/api/auth/password", changePassword);
    r.get("/api/auth/sessions", listSessions);
  },
};
export default auth;
