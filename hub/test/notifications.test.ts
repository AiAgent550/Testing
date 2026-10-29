import { describe, expect, it } from "vitest";
import { recipientsFor } from "../src/modules/notifications/notify";
import { GROUP_OF, NOTIFY_KINDS, PREF_GROUPS, TEXTS, renderNotification } from "../src/modules/notifications/texts";

const A = { id: "usr_a", lang: "en" as const }, B = { id: "usr_b", lang: "pl" as const };
const users = [A, B];
const ids = (r: { id: string }[]) => r.map(u => u.id);

describe("who gets notified", () => {
  it("tells everyone except the person who did it", () => {
    expect(ids(recipientsFor(users, { kind: "job_note", actorId: A.id }, new Set()))).toEqual([B.id]);
  });
  it("tells everyone about website and system events", () => {
    expect(ids(recipientsFor(users, { kind: "booking_new", actorId: null }, new Set()))).toEqual([A.id, B.id]);
    expect(ids(recipientsFor(users, { kind: "lead_new", actorId: null }, new Set()))).toEqual([A.id, B.id]);
  });
  it("tells only the assignee, and not when they assigned it to themselves", () => {
    expect(ids(recipientsFor(users, { kind: "job_assigned", actorId: A.id, onlyUserId: B.id }, new Set()))).toEqual([B.id]);
    expect(ids(recipientsFor(users, { kind: "job_assigned", actorId: B.id, onlyUserId: B.id }, new Set()))).toEqual([]);
  });
  it("sends a test to yourself", () => {
    expect(ids(recipientsFor(users, { kind: "test", actorId: A.id, onlyUserId: A.id }, new Set()))).toEqual([A.id]);
  });
  it("respects each person's switches, per group", () => {
    const off = new Set([`${B.id}:jobs_notes`]);
    expect(ids(recipientsFor(users, { kind: "job_note", actorId: A.id }, off))).toEqual([]);
    expect(ids(recipientsFor(users, { kind: "job_new", actorId: A.id }, off))).toEqual([B.id]);
    expect(ids(recipientsFor(users, { kind: "test", actorId: B.id, onlyUserId: B.id }, new Set([`${B.id}:jobs_notes`])))).toEqual([B.id]);
  });
});

describe("notification wording", () => {
  it("has English and Polish title and body for every kind, with the same placeholders", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
    for (const kind of NOTIFY_KINDS) for (const part of ["title", "body"]) {
      const key = `${kind}.${part}`;
      expect(TEXTS.en[key], key).toBeTruthy();
      expect(TEXTS.pl[key], key).toBeTruthy();
      expect(ph(TEXTS.pl[key]), key).toBe(ph(TEXTS.en[key]));
    }
  });
  it("puts every switchable kind in a settings group", () => {
    for (const kind of NOTIFY_KINDS) if (kind !== "test") expect(PREF_GROUPS).toContain(GROUP_OF[kind]);
  });
  it("renders in the reader's language, translating service names and dates", () => {
    const p = { ref: "CP-1001", name: "Sam Jones", service: "keys", reg: "AB12 CDE" };
    expect(renderNotification("booking_new.title", "booking_new.body", p, "en")).toEqual({ title: "New booking CP-1001", body: "Sam Jones · Keys and immobiliser · AB12 CDE" });
    expect(renderNotification("booking_new.title", "booking_new.body", p, "pl")).toEqual({ title: "Nowa rezerwacja CP-1001", body: "Sam Jones · Klucze i immobilizer · AB12 CDE" });
    const job = renderNotification("job_new.title", "job_new.body", { ref: "J-2001", title: "Keys and immobiliser · AB12 CDE", actor: "Kamil" }, "pl");
    expect(job.body).toBe("Klucze i immobilizer · AB12 CDE · dodał(a) Kamil");
    const when = renderNotification("booking_confirmed.title", "booking_confirmed.body", { ref: "CP-1", name: "Sam", start: "2026-11-02T09:30:00.000Z" }, "en");
    expect(when.body).toMatch(/^Sam · Mon 2 Nov,? 09:30$/);
  });
  it("leaves missing values out instead of printing placeholders", () => {
    const r = renderNotification("booking_new.title", "booking_new.body", { ref: "CP-2", name: "Sam", service: "remap" }, "en");
    expect(r.body).toBe("Sam · ECU remap");
    expect(renderNotification("job_note.title", "job_note.body", { ref: "J-1", note: "x".repeat(300) }, "en").body.length).toBeLessThan(160);
  });
});
