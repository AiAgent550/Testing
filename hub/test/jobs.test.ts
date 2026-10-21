import { describe, expect, it } from "vitest";
import { JOB_STATUSES, type JobStatus } from "../src/lib/types";
import { canTransition, JOB_TRANSITIONS, transitionStamps } from "../src/modules/jobs/status";
import { sniffImage } from "../src/modules/jobs/files";
import { formatReg, jobTitleForBooking } from "../src/modules/jobs/service";

describe("job status transitions", () => {
  const allowed: [JobStatus, JobStatus][] = [
    ["open", "in_progress"], ["open", "cancelled"],
    ["in_progress", "waiting_parts"], ["in_progress", "completed"], ["in_progress", "open"],
    ["waiting_parts", "in_progress"], ["waiting_parts", "cancelled"],
    ["completed", "in_progress"],
  ];
  it("allows exactly the documented moves", () => {
    for (const from of JOB_STATUSES) for (const to of JOB_STATUSES) {
      const expected = allowed.some(([a, b]) => a === from && b === to);
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
    }
  });
  it("cancelled is final and nothing skips straight to completed", () => {
    expect(JOB_TRANSITIONS.cancelled).toEqual([]);
    expect(canTransition("open", "completed")).toBe(false);
    expect(canTransition("waiting_parts", "completed")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
  });
  it("sets started_at once and completed_at on completion, clearing it on reopen", () => {
    const t1 = "2026-10-21T09:00:00.000Z", t2 = "2026-10-21T12:00:00.000Z";
    expect(transitionStamps({ started_at: null }, "in_progress", t1)).toEqual({ started_at: t1, completed_at: null });
    expect(transitionStamps({ started_at: t1 }, "completed", t2)).toEqual({ started_at: t1, completed_at: t2 });
    expect(transitionStamps({ started_at: t1 }, "in_progress", t2)).toEqual({ started_at: t1, completed_at: null });
    expect(transitionStamps({ started_at: t1 }, "waiting_parts", t2)).toEqual({});
  });
});

describe("job titles", () => {
  it("uses the service label and the formatted plate", () => {
    expect(jobTitleForBooking("keys", "WR70XYZ")).toBe("Keys and immobiliser · WR70 XYZ");
    expect(jobTitleForBooking("remap", null)).toBe("ECU remap");
    expect(formatReg("A123BCD")).toBe("A123BCD");
  });
});

describe("photo type sniffing", () => {
  const bytes = (...parts: (number[] | string)[]) => {
    const out: number[] = [];
    for (const p of parts) typeof p === "string" ? out.push(...[...p].map(c => c.charCodeAt(0))) : out.push(...p);
    while (out.length < 32) out.push(0);
    return new Uint8Array(out);
  };
  it("recognises JPEG, PNG, WebP and HEIC by their bytes", () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic"))).toBe("image/heic");
    expect(sniffImage(bytes([0, 0, 0, 24], "ftypmif1", [0, 0, 0, 0], "mif1heic"))).toBe("image/heic");
  });
  it("rejects other files, including ones pretending to be images", () => {
    expect(sniffImage(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffImage(bytes("GIF89a"))).toBeNull();
    expect(sniffImage(bytes("<svg xmlns="))).toBeNull();
    expect(sniffImage(bytes([0, 0, 0, 24], "ftypmif1", [0, 0, 0, 0], "mif1avif"))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
