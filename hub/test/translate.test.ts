import { describe, expect, it } from "vitest";
import { targetFor, translateSystem } from "../src/modules/ai/translate";

describe("translate direction", () => {
  it("swaps English and Polish whoever is reading", () => {
    for (const reader of ["en", "pl"] as const) {
      expect(targetFor("en", reader)).toBe("pl");
      expect(targetFor("pl", reader)).toBe("en");
    }
  });
  it("sends other languages to the reader's language", () => {
    expect(targetFor("other", "en")).toBe("en");
    expect(targetFor("other", "pl")).toBe("pl");
    expect(translateSystem("pl")).toMatch(/Any other language: translate into Polish/);
  });
});
