// Contract other modules use, plus read helpers shared by the jobs routes and the ai module.
import type { Env } from "../../lib/env";
import type { BookingRow, JobRow, Service, VehicleRow } from "../../lib/types";
import { audit } from "../../lib/audit";
import { all, first, newId, nextRef, now, run } from "../../lib/db";
import { conflict, notFound } from "../../lib/http";
import { getBooking, setBookingStatus } from "../bookings/service";
import { getVehicle } from "../vehicles/service";

export const SERVICE_LABELS: Record<Service, string> = {
  remap: "ECU remap", keys: "Keys and immobiliser", coding: "Coding", modules: "Module work",
  diagnostics: "Diagnostics", servicing: "Servicing and repairs", other: "Other",
};

/** "AB12CDE" -> "AB12 CDE" for current-style plates; others unchanged (same as the dashboard). */
export function formatReg(reg: string): string {
  const r = reg.toUpperCase().replace(/\s/g, "");
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r) ? `${r.slice(0, 4)} ${r.slice(4)}` : r;
}

export function jobTitleForBooking(service: Service, reg: string | null | undefined): string {
  const label = SERVICE_LABELS[service] ?? "Job";
  return reg ? `${label} · ${formatReg(reg)}` : label;
}

/** Logs a failed call to another module without failing the job operation (stubs throw until stage 2 merges). */
export async function soft<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); }
  catch (err) { console.warn(`jobs: ${what} failed: ${err instanceof Error ? err.message : String(err)}`); return null; }
}

// Reads go through the owning module's service first; a read-only SELECT is the fallback while
// those services are still stubs in this build.
async function readBooking(env: Env, id: string): Promise<BookingRow | null> {
  const viaService = await soft("bookings.getBooking", () => getBooking(env, id));
  return viaService ?? first<BookingRow>(env, "SELECT * FROM bookings WHERE id = ?", id);
}

export async function readVehicle(env: Env, id: string | null): Promise<VehicleRow | null> {
  if (!id) return null;
  const viaService = await soft("vehicles.getVehicle", () => getVehicle(env, id));
  return viaService ?? first<VehicleRow>(env, "SELECT * FROM vehicles WHERE id = ?", id);
}

export async function getJob(env: Env, id: string): Promise<JobRow | null> {
  return first<JobRow>(env, "SELECT * FROM jobs WHERE id = ?", id);
}

/** Opens a job card for a booking (one job per booking); returns the existing one if already open. */
export async function createJobFromBooking(env: Env, bookingId: string, actorId: string): Promise<JobRow> {
  return (await openJobForBooking(env, bookingId, actorId)).job;
}

export async function openJobForBooking(env: Env, bookingId: string, actorId: string): Promise<{ job: JobRow; created: boolean }> {
  const existingSql = "SELECT * FROM jobs WHERE booking_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1";
  const existing = await first<JobRow>(env, existingSql, bookingId);
  if (existing) return { job: existing, created: false };

  const booking = await readBooking(env, bookingId);
  if (!booking) throw notFound("Booking");
  if (booking.status === "cancelled" || booking.status === "no_show") throw conflict("This booking was cancelled, so a job can't be opened from it.");

  const vehicle = await readVehicle(env, booking.vehicle_id);
  const id = newId("job");
  const ref = await nextRef(env, "job_ref", "J");
  const t = now();
  // Insert only if no other request opened a job for this booking in the meantime.
  const res = await run(
    env,
    `INSERT INTO jobs (id, ref, booking_id, customer_id, vehicle_id, title, description, status, mileage, created_by, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE booking_id = ? AND status != 'cancelled')`,
    id, ref, booking.id, booking.customer_id, booking.vehicle_id, jobTitleForBooking(booking.service, vehicle?.reg),
    booking.description, null, actorId, t, t, booking.id,
  );
  if (!res.meta.changes) {
    const raced = await first<JobRow>(env, existingSql, bookingId);
    if (raced) return { job: raced, created: false };
  }
  await audit(env, actorId, "job.create_from_booking", "job", id, { booking_id: booking.id, ref });
  if (booking.status === "requested" || booking.status === "confirmed") {
    await soft("bookings.setBookingStatus(in_progress)", () => setBookingStatus(env, booking.id, "in_progress", actorId));
  }
  return { job: (await getJob(env, id))!, created: true };
}

/** What the AI needs about a job: vehicle facts, the job text and the latest notes. Never customer details. */
export async function jobContextForAi(env: Env, jobId: string): Promise<{
  job: JobRow;
  vehicle: Pick<VehicleRow, "make" | "model" | "year" | "fuel_type" | "engine_cc" | "vin"> | null;
  notes: string[];
} | null> {
  const job = await getJob(env, jobId);
  if (!job) return null;
  const v = await readVehicle(env, job.vehicle_id);
  const notes = await all<{ body: string }>(env, "SELECT body FROM job_notes WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 10", jobId);
  return {
    job,
    vehicle: v ? { make: v.make, model: v.model, year: v.year, fuel_type: v.fuel_type, engine_cc: v.engine_cc, vin: v.vin } : null,
    notes: notes.map(n => n.body).reverse(),
  };
}
