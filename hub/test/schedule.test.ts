import { describe, expect, it } from "vitest";
import { cleanFlags, endDay, noteDay, parseFlags, ukDay } from "../src/modules/jobs/schedule";

describe("job calendar helpers", () => {
  it("keeps only known flags, once each, in order", () => {
    expect(cleanFlags(["customer_informed", "bogus", "parts_ordered", "parts_ordered"])).toEqual(["parts_ordered", "customer_informed"]);
    expect(cleanFlags("parts_ordered")).toEqual([]);
    expect(parseFlags("not json")).toEqual([]);
    expect(parseFlags('["ready_collect"]')).toEqual(["ready_collect"]);
  });
  it("uses the UK day for booking slots and counts job days inclusively", () => {
    expect(ukDay("2026-07-14T23:30:00.000Z")).toBe("2026-07-15"); // 00:30 BST
    expect(ukDay("2026-12-14T23:30:00.000Z")).toBe("2026-12-14"); // GMT
    expect(ukDay(null)).toBeNull();
    expect(endDay("2026-11-30", 3)).toBe("2026-12-02");
    expect(endDay("2026-11-30", 1)).toBe("2026-11-30");
    expect(noteDay("2026-11-18")).toBe("18 Nov 2026");
  });
});
