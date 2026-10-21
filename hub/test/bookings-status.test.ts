import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, type BookingStatus } from "../src/lib/types";
import { TRANSITIONS, canTransition, ukToday } from "../src/modules/bookings/status";

describe("booking status transitions", () => {
  const allowed: [BookingStatus, BookingStatus][] = [
    ["requested", "confirmed"], ["requested", "in_progress"], ["requested", "cancelled"],
    ["confirmed", "in_progress"], ["confirmed", "cancelled"], ["confirmed", "no_show"], ["confirmed", "requested"],
    ["in_progress", "completed"], ["in_progress", "confirmed"],
    ["cancelled", "requested"],
  ];

  it("allows exactly the documented moves", () => {
    for (const from of BOOKING_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("covers every status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it("treats completed and no-show as final, and cancelled only re-opens", () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.no_show).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual(["requested"]);
    expect(canTransition("requested", "completed")).toBe(false);
  });

  it("works out today's date on UK time", () => {
    expect(ukToday(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02"); // BST: already the 2nd in London
    expect(ukToday(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15"); // GMT
  });
});
