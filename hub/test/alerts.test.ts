import { describe, expect, it, vi } from "vitest";
import { alertSubject, alertText, sendStaffAlert } from "../src/modules/notifications/alerts";
import type { Env } from "../src/lib/env";

const env = (send?: (m: unknown) => Promise<unknown>) =>
  ({ SITE_ORIGIN: "https://curveperformance.co.uk", STAFF_ALERT_TO: "owner@example.com", STAFF_MAIL: send ? { send } : undefined } as unknown as Env);

describe("staff alerts", () => {
  it("builds a tagged, scannable subject and drops empty parts", () => {
    expect(alertSubject({ kind: "BOOKING", subject: ["CP-1001", "Sam  Jones", "ECU remap", null, ""] })).toBe("[BOOKING] CP-1001 · Sam Jones · ECU remap");
  });
  it("lists only filled-in lines and ends with the Hub link", () => {
    const t = alertText({ lines: [["Name", "Sam"], ["Email", null], ["Reg", " AB12CDE "]], link: "https://hub.example/app/#/bookings/b1" });
    expect(t).toBe("Name: Sam\nReg: AB12CDE\n\nOpen in Curve Hub: https://hub.example/app/#/bookings/b1\n");
  });
  it("sends from hub@ the site's domain with the customer as reply-to", async () => {
    const send = vi.fn(async () => ({}));
    const ok = await sendStaffAlert(env(send), { kind: "BOOKING", subject: ["CP-1001"], lines: [], link: "x", replyTo: "sam@example.com" });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Curve Hub", email: "hub@curveperformance.co.uk" }, to: "owner@example.com", subject: "[BOOKING] CP-1001", replyTo: "sam@example.com",
    }));
  });
  it("is a quiet no-op without the binding, and never throws when sending fails", async () => {
    expect(await sendStaffAlert(env(), { kind: "LEAD", subject: [], lines: [], link: "x" })).toBe(false);
    expect(await sendStaffAlert(env(async () => { throw new Error("down"); }), { kind: "LEAD", subject: [], lines: [], link: "x" })).toBe(false);
  });
});
