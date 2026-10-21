// Contract other modules use. Implemented in stage 3.
import type { Env } from "../../lib/env";
import type { JobRow } from "../../lib/types";

/** Opens a job card for a booking (one job per booking); returns the existing one if already open. */
export async function createJobFromBooking(_env: Env, _bookingId: string, _actorId: string): Promise<JobRow> {
  throw new Error("jobs.createJobFromBooking not implemented yet");
}
