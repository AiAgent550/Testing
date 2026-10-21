// End-to-end check against a running Hub (default http://localhost:8787).
// Exercises the real sign-in flow including two-step verification, the auth gates,
// origin checks, rate limiting and security headers. Exit code 1 on any failure.
import { createHmac } from "node:crypto";

const BASE = process.env.HUB_URL || "http://localhost:8787";
const EMAIL = process.env.SMOKE_EMAIL, PASSWORD = process.env.SMOKE_PASSWORD;
let failures = 0, cookie = "";

const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`); if (!ok) failures++; };

async function req(path, { method = "GET", body, origin = BASE, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  if (auth && cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  if ((res.headers.get("content-type") || "").includes("json")) data = await res.json();
  return { res, data };
}

function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = [];
  for (const c of s.replace(/\s/g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 30000), buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", b32decode(secret)).update(buf).digest(), off = mac[mac.length - 1] & 15;
  return String(((mac.readUInt32BE(off) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

if (!EMAIL || !PASSWORD) { console.error("Set SMOKE_EMAIL and SMOKE_PASSWORD"); process.exit(2); }

let r = await req("/api/system/health", { auth: false });
check("health endpoint is public and reports the database", r.res.status === 200 && r.data?.ok === true, JSON.stringify(r.data));

r = await req("/login", { auth: false });
const csp = r.res.headers.get("content-security-policy") || "";
check("sign-in page is served", r.res.status === 200);
check("security headers: CSP blocks inline script and framing", csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), csp);
check("security headers: HSTS, nosniff, DENY framing", !!r.res.headers.get("strict-transport-security") && r.res.headers.get("x-content-type-options") === "nosniff" && r.res.headers.get("x-frame-options") === "DENY");

r = await req("/app/", { auth: false });
check("dashboard redirects to sign-in without a session", r.res.status === 302 && (r.res.headers.get("location") || "").endsWith("/login"));
r = await req("/app/js/core.js", { auth: false });
check("dashboard scripts are not public", r.res.status === 302);
r = await req("/api/system/overview", { auth: false });
check("API refuses anonymous requests", r.res.status === 401);
r = await req("/api/nope", { auth: false });
check("unknown API path is a clean 404", r.res.status === 404 && r.data?.error?.code === "not_found");

r = await req("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD + "x" }, auth: false });
check("wrong password is rejected", r.res.status === 401 && !cookie);
r = await req("/api/auth/login", { method: "POST", body: { email: "nobody@example.com", password: "whatever" }, auth: false });
check("unknown email gets the same message as a wrong password", r.res.status === 401 && r.data?.error?.message === "Email or password is incorrect.");
r = await req("/api/auth/login", { method: "POST", body: { email: "not-an-email", password: "" }, auth: false });
check("invalid sign-in input lists field errors", r.res.status === 400 && r.data?.error?.fields?.email && r.data?.error?.fields?.password);

r = await req("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
check("correct password starts a session", r.res.status === 200 && !!cookie, JSON.stringify(r.data));
check("session cookie is HttpOnly and SameSite=Strict", /HttpOnly/i.test(r.res.headers.get("set-cookie") || "") && /SameSite=Strict/i.test(r.res.headers.get("set-cookie") || ""));
const next = r.data?.next;

r = await req("/api/system/overview");
check("password alone does not open the API (two-step required)", r.res.status === 401);
r = await req("/app/");
check("password alone does not open the dashboard", r.res.status === 302);

let secret;
if (next === "setup") {
  r = await req("/api/auth/totp/setup");
  secret = r.data?.secret;
  check("first sign-in issues an authenticator secret", !!secret && (r.data?.otpauth || "").startsWith("otpauth://totp/"));
} else {
  secret = process.env.SMOKE_TOTP_SECRET;
  check("returning user is asked for a code", next === "totp");
}

r = await req("/api/auth/totp", { method: "POST", body: { code: "000000" } });
check("wrong code is rejected", r.res.status === 401);
r = await req("/api/auth/totp", { method: "POST", body: { code: totp(secret) } });
check("correct code completes sign-in", r.res.status === 200, JSON.stringify(r.data));

r = await req("/app/");
check("dashboard opens after two-step sign-in", r.res.status === 200 && (r.res.headers.get("content-type") || "").includes("text/html"));
r = await req("/api/system/overview");
check("overview returns counts", r.res.status === 200 && typeof r.data?.counts?.openJobs === "number", JSON.stringify(r.data));

r = await req("/api/settings/business", { method: "PUT", body: { value: { name: "M&K Auto Services", phone: "07700 900123" } }, origin: "https://evil.example" });
check("changes from another website are blocked (CSRF)", r.res.status === 403);
r = await req("/api/settings/business", { method: "PUT", body: { value: { name: "M&K Auto Services", phone: "07700 900123" } } });
check("settings save from the Hub itself", r.res.status === 200 && r.data?.value?.phone === "07700 900123");
r = await req("/api/settings/business");
check("settings read back", r.data?.value?.phone === "07700 900123");
r = await req("/api/system/audit?limit=5");
check("changes are written to the audit log", r.data?.entries?.some(e => e.action === "settings.update"));

r = await req("/api/auth/logout", { method: "POST" });
const old = cookie;
r = await req("/api/system/overview");
check("signing out ends the session", r.res.status === 401, String(r.res.status));
void old;

// Rate limiting: five wrong passwords lock that email for 15 minutes.
cookie = "";
const victim = `locktest+${Date.now()}@example.com`;
for (let i = 0; i < 5; i++) await req("/api/auth/login", { method: "POST", body: { email: victim, password: "wrong-password" }, auth: false });
r = await req("/api/auth/login", { method: "POST", body: { email: victim, password: "wrong-password" }, auth: false });
check("repeated wrong passwords are rate limited", r.res.status === 429);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
