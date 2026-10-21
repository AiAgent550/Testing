// Contract other modules use.
import type { Env } from "../../lib/env";
import { audit } from "../../lib/audit";
import { now, run } from "../../lib/db";

/**
 * Marks a lead as booked and links the booking. Called by bookings when a lead is converted
 * (and by the leads "Book in" route). Safe to call twice with the same booking.
 */
export async function markLeadBooked(env: Env, leadId: string, bookingId: string): Promise<void> {
  const res = await run(
    env,
    "UPDATE leads SET status = 'booked', booking_id = ?, updated_at = ? WHERE id = ? AND (status != 'booked' OR booking_id IS NOT ?)",
    bookingId, now(), leadId, bookingId,
  );
  if (res.meta.changes) await audit(env, null, "lead.booked", "lead", leadId, { booking_id: bookingId });
}
