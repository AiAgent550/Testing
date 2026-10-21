// Test client for scripts/smoke-*.mjs: signs a user in (password + TOTP) and returns a request helper.
// verify.sh creates a fresh user per smoke file and passes SMOKE_EMAIL / SMOKE_PASSWORD.
import { createHmac } from "node:crypto";

export const BASE = process.env.HUB_URL || "http://localhost:8787";
export const SITE_ORIGIN = process.env.SITE_ORIGIN || "http://localhost:8765";

function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = [];
  for (const c of s.replace(/\s/g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret) {
  const counter = Math.floor(Date.now() / 30000), buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", b32decode(secret)).update(buf).digest(), off = mac[mac.length - 1] & 15;
  return String(((mac.readUInt32BE(off) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

/** Raw request without a session (public endpoints). */
export async function anon(path, { method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof FormData)) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), redirect: "manual" });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  return { res, data, status: res.status };
}

/** Signs in and returns `call(path, opts)` that sends the session cookie and the Hub's Origin. */
export async function signIn(email = process.env.SMOKE_EMAIL, password = process.env.SMOKE_PASSWORD) {
  let cookie = "";
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const h = { origin: BASE, ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined && !(body instanceof FormData)) h["content-type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
    return { res, data, status: res.status };
  };
  const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(login.data)}`);
  const setup = await call("/api/auth/totp/setup");
  if (setup.status !== 200) throw new Error(`totp setup failed: ${JSON.stringify(setup.data)}`);
  const ok = await call("/api/auth/totp", { method: "POST", body: { code: totp(setup.data.secret) } });
  if (ok.status !== 200) throw new Error(`totp failed: ${JSON.stringify(ok.data)}`);
  return call;
}

/** Tiny assertion helper with a pass/fail summary. */
export function checker(name) {
  let failures = 0;
  return {
    check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  [${name}] ${label}${ok ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); if (!ok) failures++; },
    done() { console.log(failures ? `[${name}] ${failures} check(s) failed` : `[${name}] all checks passed`); process.exit(failures ? 1 : 0); },
  };
}
