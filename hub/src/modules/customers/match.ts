// Pure helpers for recognising returning customers.
import type { CustomerRow } from "../../lib/types";
import { ukPhone } from "../../lib/validate";

/** UK phone to E.164, or null when it isn't a usable number. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  try { return ukPhone()(String(raw), "phone"); } catch { return null; }
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const s = (raw || "").trim().toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Fields to fill on an existing customer: only the ones that are blank there and known now. */
export function blankFieldPatch(
  existing: Pick<CustomerRow, "phone" | "email" | "notes">,
  incoming: { phone: string | null; email: string | null; notes?: string | null },
): Partial<Pick<CustomerRow, "phone" | "email" | "notes">> {
  const patch: Partial<Pick<CustomerRow, "phone" | "email" | "notes">> = {};
  if (!existing.phone && incoming.phone) patch.phone = incoming.phone;
  if (!existing.email && incoming.email) patch.email = incoming.email;
  if (!existing.notes && incoming.notes) patch.notes = incoming.notes;
  return patch;
}

/** Text for a LIKE search with % and _ escaped (use with ESCAPE '\'). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, c => "\\" + c);

/**
 * Turns a phone-ish search ("07700 900", "+44 7700") into the digits to look for inside a stored
 * E.164 number, or null when the query isn't a phone number.
 */
export function phoneSearchDigits(q: string): string | null {
  const s = q.replace(/[\s()-]/g, "");
  if (!/^\+?\d{4,15}$/.test(s)) return null;
  let d = s.replace(/^\+/, "");
  if (d.startsWith("44")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 3 ? d : null;
}
