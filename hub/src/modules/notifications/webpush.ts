// Web Push for the installed Hub app, with WebCrypto only (runs in the Worker and in tests):
//   - VAPID (RFC 8292): an ES256 JWT that identifies this server to the browser's push service.
//   - Message encryption (RFC 8291 + RFC 8188 "aes128gcm"): only the subscribed device can read the payload.

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** P-256 private key from its raw 32-byte scalar plus the 65-byte uncompressed public point. */
function privateJwk(d: Uint8Array, publicRaw: Uint8Array): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("Expected a 65-byte uncompressed P-256 public key.");
  return { kty: "EC", crv: "P-256", d: b64urlEncode(d), x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33)), ext: true };
}

// ---------- VAPID ----------
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }

/** The Authorization header value for a push request to `endpoint` (valid 12 hours). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: keys.subject })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", privateJwk(b64urlDecode(keys.privateKey), b64urlDecode(keys.publicKey)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto returns the raw 64-byte r||s signature, which is exactly the JWS ES256 format.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

// ---------- payload encryption ----------
export interface PushTarget { p256dh: string; auth: string }

/** Fixed sender key and salt for reproducing the RFC 8291 test vector; omitted in real use. */
export interface EncryptOverrides { salt?: Uint8Array; senderPrivate?: Uint8Array; senderPublic?: Uint8Array }

const RECORD_SIZE = 4096;

/** Encrypts `plaintext` for one subscription. Returns the aes128gcm body (header + one record). */
export async function encryptPayload(target: PushTarget, plaintext: Uint8Array, o: EncryptOverrides = {}): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Invalid push subscription keys.");
  if (plaintext.length > RECORD_SIZE - 17 - 86) throw new Error("Push payload is too large.");

  let senderPublic: Uint8Array, senderPrivateKey: CryptoKey;
  if (o.senderPrivate && o.senderPublic) {
    senderPublic = o.senderPublic;
    senderPrivateKey = await crypto.subtle.importKey("jwk", privateJwk(o.senderPrivate, o.senderPublic), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
    senderPrivateKey = pair.privateKey;
  }
  // The standard parameter name is "public"; the Workers type definitions call it $public.
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, senderPrivateKey, 256));

  // RFC 8291 section 3.4: combine the shared secret with the subscription's auth secret.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, senderPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);

  // RFC 8188: content encryption key and nonce from a random salt.
  const salt = o.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2])); // single, final record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded));

  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, cipher);
}

// ---------- sending ----------
export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }
export type PushOutcome = "ok" | "gone" | "error";

/** Sends one encrypted message. "gone" means the subscription no longer exists and should be deleted. */
export async function sendPush(sub: PushSubscriptionRow, payload: unknown, keys: VapidKeys, opts: { ttl?: number; urgency?: "normal" | "high"; timeoutMs?: number } = {}): Promise<PushOutcome> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(sub.endpoint, keys),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(opts.ttl ?? 24 * 3600),
      urgency: opts.urgency ?? "normal",
    },
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (res.status >= 200 && res.status < 300) return "ok";
  console.warn("push rejected", res.status, (await res.text().catch(() => "")).slice(0, 200));
  return "error";
}

/** Push services the Hub will deliver to (the endpoint comes from the browser; this stops it pointing anywhere else). */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

export function isAllowedEndpoint(endpoint: string, allowLocal = false): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (allowLocal && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
  return u.protocol === "https:" && PUSH_HOSTS.some(re => re.test(u.hostname));
}
