// Row shapes shared between modules. They mirror migrations/0001_init.sql exactly.
export type Service = "remap" | "keys" | "coding" | "modules" | "diagnostics" | "servicing" | "other";
export const SERVICES: readonly Service[] = ["remap", "keys", "coding", "modules", "diagnostics", "servicing", "other"];
export type Source = "website" | "phone" | "social" | "walk_in" | "other";
export const SOURCES: readonly Source[] = ["website", "phone", "social", "walk_in", "other"];

export interface CustomerRow {
  id: string; name: string; phone: string | null; email: string | null; notes: string | null;
  source: Source; created_at: string; updated_at: string;
}

export interface VehicleRow {
  id: string; reg: string; vin: string | null; make: string | null; model: string | null; colour: string | null;
  fuel_type: string | null; year: number | null; engine_cc: number | null; mot_status: string | null; mot_expiry: string | null;
  tax_status: string | null; tax_due: string | null; last_mileage: number | null; dvla_json: string | null; dvsa_json: string | null;
  looked_up_at: string | null; customer_id: string | null; created_at: string; updated_at: string;
}

export type BookingStatus = "requested" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
export const BOOKING_STATUSES: readonly BookingStatus[] = ["requested", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

export interface BookingRow {
  id: string; ref: string; customer_id: string; vehicle_id: string | null; service: Service; description: string | null;
  preferred_date: string | null; scheduled_start: string | null; scheduled_end: string | null;
  location: "workshop" | "mobile"; address: string | null; status: BookingStatus; source: Source;
  lead_id: string | null; internal_notes: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export type JobStatus = "open" | "in_progress" | "waiting_parts" | "completed" | "cancelled";
export const JOB_STATUSES: readonly JobStatus[] = ["open", "in_progress", "waiting_parts", "completed", "cancelled"];

export interface JobRow {
  id: string; ref: string; booking_id: string | null; customer_id: string | null; vehicle_id: string | null;
  title: string; description: string | null; status: JobStatus; assigned_to: string | null; mileage: number | null;
  started_at: string | null; completed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}

export type Platform = "instagram" | "facebook" | "youtube" | "tiktok" | "google";
export const PLATFORMS: readonly Platform[] = ["instagram", "facebook", "youtube", "tiktok", "google"];

export interface LeadRow {
  id: string; comment_id: string | null; platform: Platform; author_name: string | null; author_handle: string | null;
  summary: string; service: Service | null; make: string | null; model: string | null; urgency: "low" | "normal" | "high" | null;
  score: number; suggested_reply: string | null; status: "new" | "replied" | "booked" | "dismissed";
  booking_id: string | null; reply_external_id: string | null; replied_at: string | null; created_at: string; updated_at: string;
}
