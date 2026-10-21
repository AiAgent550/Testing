// Booking status transitions. Pure, so it can be unit tested and mirrored in the dashboard.
import type { BookingStatus } from "../../lib/types";

export const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled", "no_show", "requested"],
  in_progress: ["completed", "confirmed"],
  completed: [],
  cancelled: ["requested"], // re-open
  no_show: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean => TRANSITIONS[from]?.includes(to) ?? false;

export const STATUS_LABELS: Record<BookingStatus, string> = {
  requested: "requested", confirmed: "confirmed", in_progress: "in progress", completed: "completed", cancelled: "cancelled", no_show: "a no-show",
};

/** Today's date in the UK as YYYY-MM-DD (the business runs on UK time). */
export function ukToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
