// End-to-end checks for invite links: create account, set up two-step sign-in, and the ways a link is refused.
import { execFileSync } from "node:child_process";
import { BASE, anon, checker, totp } from "./hubclient.mjs";

const { check, done } = checker("invite");
const invite = (email, hours) => JSON.parse(execFileSync("node", ["scripts/invite.mjs", "--email", email, "--json", ...(hours ? ["--hours", String(hours)] : [])]).toString().trim().split("\n").pop());
const hub = { origin: BASE };
const sql = s => execFileSync("npx", ["wrangler", "d1", "execute", "curve-hub", "--local", "--command", s], { stdio: "ignore" });

const a = invite("New.Owner@Example.com");
let r = await anon("/api/auth/invite/check", { method: "POST", body: { token: a.token }, headers: hub });
check("a fresh invite shows who it is for", r.status === 200 && r.data?.email === "new.owner@example.com", r.data);

r = await anon("/api/auth/invite", { method: "POST", body: { token: a.token, name: "New Owner", password: "short" }, headers: hub });
check("a short password is refused with a field error", r.status === 400 && !!r.data?.error?.fields?.password, r.data);

r = await anon("/api/auth/invite", { method: "POST", body: { token: a.token, name: "New Owner", password: "a long enough passphrase" }, headers: { origin: "https://evil.example" } });
check("accepting from another site is refused", r.status === 403);

r = await anon("/api/auth/invite", { method: "POST", body: { token: a.token, name: "New Owner", password: "a long enough passphrase" }, headers: hub });
const cookie = (r.res.headers.get("set-cookie") || "").split(";")[0];
check("accepting creates the account and a half-signed-in session", r.status === 200 && r.data?.next === "setup" && !!cookie, r.data);

const as = (path, opts = {}) => anon(path, { ...opts, headers: { ...hub, cookie, ...(opts.headers || {}) } });
r = await as("/api/bookings");
check("the new session can't see data before two-step sign-in", r.status === 401 || r.status === 403, r.status);
const setup = await as("/api/auth/totp/setup");
r = await as("/api/auth/totp", { method: "POST", body: { code: totp(setup.data?.secret || "") } });
check("two-step setup completes the sign-in", setup.status === 200 && r.status === 200, r.data);
r = await as("/api/auth/me");
check("the account has the chosen name and the invited email", r.data?.user?.name === "New Owner" && r.data?.user?.email === "new.owner@example.com" && r.data?.mfa_ok === true, r.data);

r = await anon("/api/auth/login", { method: "POST", body: { email: "new.owner@example.com", password: "a long enough passphrase" }, headers: hub });
check("the chosen password signs in later", r.status === 200 && r.data?.next === "totp", r.data);

r = await anon("/api/auth/invite", { method: "POST", body: { token: a.token, name: "Someone Else", password: "another long passphrase" }, headers: hub });
check("a used link can't be used again", r.status === 401, r.data);

const b = invite("new.owner@example.com");
r = await anon("/api/auth/invite", { method: "POST", body: { token: b.token, name: "Dup", password: "another long passphrase" }, headers: hub });
check("an invite for an email that already has an account is refused", r.status === 409, r.data);

const pl = invite("polski@example.com");
r = await anon("/api/auth/invite", { method: "POST", body: { token: pl.token, name: "Kamil", password: "bardzo dlugie haslo 123", lang: "pl" }, headers: hub });
const plCookie = (r.res.headers.get("set-cookie") || "").split(";")[0];
r = await anon("/api/auth/me", { headers: { ...hub, cookie: plCookie } });
check("a language chosen on the invite page is saved to the new account", r.data?.lang === "pl", r.data);
const bad = invite("bad-lang@example.com");
r = await anon("/api/auth/invite", { method: "POST", body: { token: bad.token, name: "X", password: "another long passphrase", lang: "xx" }, headers: hub });
check("an unknown language on the invite is refused", r.status === 400 && !!r.data?.error?.fields?.lang, r.data);

const c = invite("late@example.com");
sql(`UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'late@example.com'`);
r = await anon("/api/auth/invite/check", { method: "POST", body: { token: c.token }, headers: hub });
check("an expired link is refused", r.status === 401, r.data);

r = await anon("/api/auth/invite/check", { method: "POST", body: { token: "f".repeat(64) }, headers: hub });
check("a made-up token is refused", r.status === 401, r.data);

done();
