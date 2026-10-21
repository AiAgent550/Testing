// Job status rules: which moves are allowed and what timestamps each move sets.
import type { JobStatus } from "../../lib/types";

export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_parts", "completed", "open"],
  waiting_parts: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: [],
};

export const ACTIVE_STATUSES: readonly JobStatus[] = ["open", "in_progress", "waiting_parts"];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Timestamp columns to set for a move (started_at is kept from the first start). */
export function transitionStamps(
  job: { started_at: string | null },
  to: JobStatus,
  at: string,
): { started_at?: string | null; completed_at?: string | null } {
  if (to === "in_progress") return { started_at: job.started_at ?? at, completed_at: null };
  if (to === "completed") return { started_at: job.started_at ?? at, completed_at: at };
  return {};
}
