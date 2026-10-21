import { describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, decrypt, encrypt, hashPassword, newTotpSecret, randomBytes, toB64, totpAt, verifyPassword, verifyTotp,
} from "../src/lib/crypto";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", h)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toEqual(await hashPassword("same"));
  });
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });
});

describe("encryption at rest", () => {
  const key = toB64(randomBytes(32));
  it("round-trips", async () => {
    const blob = await encrypt("JBSWY3DPEHPK3PXP", key);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(await decrypt(blob, key)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("fails with the wrong key", async () => {
    const blob = await encrypt("secret", key);
    await expect(decrypt(blob, toB64(randomBytes(32)))).rejects.toThrow();
  });
  it("refuses to run without a key", async () => {
    await expect(encrypt("x", undefined)).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vector for SHA-1", async () => {
    // RFC 6238 secret "12345678901234567890", T = 59 s -> 94287082 (8 digits); 6-digit form is 287082.
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    expect(await totpAt(secret, Math.floor(59 / 30))).toBe("287082");
  });
  it("accepts the current code and one step of drift, rejects older", async () => {
    const secret = newTotpSecret();
    const t = 1_800_000_000_000;
    const step = Math.floor(t / 30_000);
    expect(await verifyTotp(secret, await totpAt(secret, step), t)).toBe(true);
    expect(await verifyTotp(secret, await totpAt(secret, step - 1), t)).toBe(true);
    expect(await verifyTotp(secret, await totpAt(secret, step - 3), t)).toBe(false);
    expect(await verifyTotp(secret, "12345", t)).toBe(false);
  });
  it("base32 round-trips", () => {
    const bytes = randomBytes(20);
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
  });
});
