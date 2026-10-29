import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, isAllowedEndpoint, vapidAuthorization } from "../src/modules/notifications/webpush";

// RFC 8291 Appendix A.
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("web push encryption", () => {
  it("reproduces the RFC 8291 test vector", async () => {
    const body = await encryptPayload({ p256dh: V.uaPublic, auth: V.auth }, new TextEncoder().encode(V.plaintext), {
      salt: b64urlDecode(V.salt), senderPrivate: b64urlDecode(V.asPrivate), senderPublic: b64urlDecode(V.asPublic),
    });
    expect(b64urlEncode(body)).toBe(V.body);
  });

  it("uses a fresh salt and sender key for every message", async () => {
    const a = await encryptPayload({ p256dh: V.uaPublic, auth: V.auth }, new TextEncoder().encode("hi"));
    const b = await encryptPayload({ p256dh: V.uaPublic, auth: V.auth }, new TextEncoder().encode("hi"));
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
    expect(new DataView(a.buffer).getUint32(16)).toBe(4096);
    expect(a[20]).toBe(65);
  });

  it("rejects malformed subscription keys", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: V.auth }, new Uint8Array(1))).rejects.toThrow();
  });
});

describe("VAPID", () => {
  it("signs an ES256 JWT for the push service's origin that verifies with the public key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
    const keys = { publicKey: b64urlEncode(pub), privateKey: jwk.d!, subject: "mailto:info@curveperformance.co.uk" };

    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, 1_800_000_000);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 43200, sub: keys.subject });
    const sig = b64urlDecode(s);
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("push endpoints", () => {
  it("only accepts real push services (and localhost when running locally)", () => {
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isAllowedEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedEndpoint("http://127.0.0.1:9999/push")).toBe(false);
    expect(isAllowedEndpoint("http://127.0.0.1:9999/push", true)).toBe(true);
  });
});
