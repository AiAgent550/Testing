// Short-lived signed links to a post's media, so Instagram/Facebook can fetch the file while the
// R2 bucket stays private.  token = base64url(postId + "." + expiry) + "." + base64url(HMAC-SHA256)
// with an HMAC key derived (HKDF) from ENCRYPTION_KEY, so no extra secret is needed.
import { fromB64, timingSafeEqual } from "../../lib/crypto";

export const MEDIA_TOKEN_TTL_SECONDS = 3600;
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
}

async function hmacKey(encryptionKeyB64: string | undefined): Promise<CryptoKey> {
  if (!encryptionKeyB64) throw new Error("ENCRYPTION_KEY is not set");
  const base = await crypto.subtle.importKey("raw", fromB64(encryptionKeyB64), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("mk-hub"), info: enc.encode("social-media-token-v1") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"],
  );
}

async function sign(key: CryptoKey, payload: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))));
}

export async function signMediaToken(encryptionKeyB64: string | undefined, postId: string, nowMs = Date.now(), ttlSeconds = MEDIA_TOKEN_TTL_SECONDS): Promise<string> {
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = b64url(`${postId}.${expiry}`);
  return `${payload}.${await sign(await hmacKey(encryptionKeyB64), payload)}`;
}

/** The post id when the token is genuine and unexpired; otherwise null. */
export async function verifyMediaToken(encryptionKeyB64: string | undefined, token: string, nowMs = Date.now()): Promise<string | null> {
  if (typeof token !== "string" || token.length > 300 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, sig] = token.split(".");
  let key: CryptoKey;
  try { key = await hmacKey(encryptionKeyB64); } catch { return null; }
  if (!timingSafeEqual(await sign(key, payload), sig)) return null;
  let decoded: string;
  try { decoded = fromB64url(payload); } catch { return null; }
  const dot = decoded.lastIndexOf(".");
  const postId = decoded.slice(0, dot), expiry = Number(decoded.slice(dot + 1));
  if (dot < 1 || !Number.isInteger(expiry) || expiry * 1000 < nowMs) return null;
  return postId;
}
