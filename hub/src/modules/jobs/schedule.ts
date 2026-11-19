// Calendar bits of a job: the day it's booked in for, and quick status flags ("Parts ordered", "Customer informed").
// Pure helpers so they can be tested on their own.

export const JOB_FLAGS = ["parts_ordered", "parts_in", "customer_informed", "waiting_customer", "ready_collect"] as const;
export type JobFlag = (typeof JOB_FLAGS)[number];

/** The note written on the job when a flag is switched on (English; the dashboard translates these exact texts). */
export const FLAG_NOTES: Record<JobFlag, string> = {
  parts_ordered: "Parts ordered",
  parts_in: "Parts arrived",
  customer_informed: "Customer informed",
  waiting_customer: "Waiting on the customer",
  ready_collect: "Ready to collect",
};

/** Cleans a flags list from the dashboard: known flags only, each once, in the standard order. */
export function cleanFlags(input: unknown): JobFlag[] {
  const wanted = new Set(Array.isArray(input) ? input.filter((f): f is string => typeof f === "string") : []);
  return JOB_FLAGS.filter(f => wanted.has(f));
}

export function parseFlags(stored: string | null | undefined): JobFlag[] {
  try { return cleanFlags(JSON.parse(stored || "[]")); } catch { return []; }
}

/** The UK calendar day of an ISO time (a 00:30 BST slot is still that day, not the day before in UTC). */
export function ukDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/** "18 Nov 2026" for notes. */
export function noteDay(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Last day a job occupies (inclusive). */
export function endDay(start: string, days: number): string {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(1, days) - 1);
  return d.toISOString().slice(0, 10);
}
