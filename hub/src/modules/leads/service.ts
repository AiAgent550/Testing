// Contract other modules use. Implemented in stage 4.
import type { Env } from "../../lib/env";

/** Marks a lead as booked and links the booking. Called by bookings when a lead is converted. */
export async function markLeadBooked(_env: Env, _leadId: string, _bookingId: string): Promise<void> {
  throw new Error("leads.markLeadBooked not implemented yet");
}
