import { describe, expect, it } from "vitest";
import { blankFieldPatch, likeEscape, normaliseEmail, normalisePhone, phoneSearchDigits } from "../src/modules/customers/match";

describe("customer matching helpers", () => {
  it("normalises phone numbers so the same person matches however they typed it", () => {
    expect(normalisePhone("07700 900123")).toBe("+447700900123");
    expect(normalisePhone("+44 (0)7700-900123".replace("(0)", ""))).toBe("+447700900123");
    expect(normalisePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalisePhone("+447700900123")).toBe("+447700900123");
    expect(normalisePhone("12")).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  it("normalises emails", () => {
    expect(normaliseEmail("  Dan@Example.COM ")).toBe("dan@example.com");
    expect(normaliseEmail("not an email")).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
  });

  it("only fills blank fields on a matched customer", () => {
    expect(blankFieldPatch({ phone: "+447700900123", email: null, notes: null }, { phone: "+447700900999", email: "a@b.co" }))
      .toEqual({ email: "a@b.co" });
    expect(blankFieldPatch({ phone: null, email: "a@b.co", notes: "VIP" }, { phone: "+447700900123", email: "other@b.co", notes: "new" }))
      .toEqual({ phone: "+447700900123" });
    expect(blankFieldPatch({ phone: "+44", email: "x@y.z", notes: "n" }, { phone: null, email: null })).toEqual({});
  });

  it("builds safe search terms", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(phoneSearchDigits("07700 900")).toBe("7700900");
    expect(phoneSearchDigits("+44 7700")).toBe("7700");
    expect(phoneSearchDigits("Dan")).toBeNull();
    expect(phoneSearchDigits("12")).toBeNull();
  });
});
