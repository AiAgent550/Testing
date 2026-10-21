import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/http";
import { email, isoDate, normaliseReg, oneOf, optional, parse, reg, str, ukPhone, vin } from "../src/lib/validate";

describe("validation", () => {
  it("normalises UK registrations", () => {
    expect(normaliseReg(" ab12 cde ")).toBe("AB12CDE");
    expect(parse({ r: "wr 70 xyz" }, { r: reg() }).r).toBe("WR70XYZ");
  });
  it("normalises UK phone numbers to E.164", () => {
    expect(parse({ p: "07700 900123" }, { p: ukPhone() }).p).toBe("+447700900123");
    expect(parse({ p: "+44 7700 900123" }, { p: ukPhone() }).p).toBe("+447700900123");
  });
  it("validates VINs", () => {
    expect(parse({ v: "wdd2050422f123456" }, { v: vin() }).v).toBe("WDD2050422F123456");
    expect(() => parse({ v: "WDD2050422F12345O" }, { v: vin() })).toThrow(HttpError);
  });
  it("collects every field error at once", () => {
    try {
      parse({ e: "nope", s: "", k: "x" }, { e: email(), s: str(), k: oneOf(["a", "b"] as const), d: optional(isoDate()) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect(Object.keys((e as HttpError).fields!)).toEqual(["e", "s", "k"]);
    }
  });
  it("rejects non-objects", () => {
    expect(() => parse("string", { a: str() })).toThrow(HttpError);
  });
});
