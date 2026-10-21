// Contract other modules use. Implemented in stage 2.
import type { Env } from "../../lib/env";
import type { BookingRow, Service, Source } from "../../lib/types";

export interface BookingInput {
  customer: { name: string; phone?: string | null; email?: string | null };
  reg?: string | null;
  service: Service;
  description?: string | null;
  preferred_date?: string | null;
  location: "workshop" | "mobile";
  address?: string | null;
  source: Source;
  lead_id?: string | null;
}

export async function createBooking(_env: Env, _input: BookingInput, _actorId: string | null): Promise<BookingRow> {
  throw new Error("bookings.createBooking not implemented yet");
}

export async function getBooking(_env: Env, _id: string): Promise<BookingRow | null> {
  throw new Error("bookings.getBooking not implemented yet");
}
