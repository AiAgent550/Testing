// Contract other modules use: creating bookings, reading them and moving their status on.
import type { Env } from "../../lib/env";
import type { BookingRow, BookingStatus, Service, Source } from "../../lib/types";
import { audit } from "../../lib/audit";
import { first, newId, nextRef, now, run } from "../../lib/db";
import { conflict, notFound } from "../../lib/http";
import { findOrCreateCustomer, getCustomer } from "../customers/service";
import { ensureVehicle } from "../vehicles/service";
import { queueMessage } from "../notifications";
import { markLeadBooked } from "../leads/service";
import { STATUS_LABELS, canTransition } from "./status";

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

export async function createBooking(env: Env, input: BookingInput, actorId: string | null): Promise<BookingRow> {
  const customer = await findOrCreateCustomer(env, { ...input.customer, source: input.source }, actorId);

  let vehicleId: string | null = null;
  if (input.reg) {
    try { vehicleId = (await ensureVehicle(env, input.reg, customer.id, actorId)).id; }
    catch (err) { console.warn("booking: vehicle not saved", input.reg, err); } // the booking matters more than the car record
  }

  const id = newId("bkg"), t = now();
  const ref = await nextRef(env, "booking_ref", "MK");
  await run(
    env,
    `INSERT INTO bookings (id, ref, customer_id, vehicle_id, service, description, preferred_date, location, address, status, source, lead_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?)`,
    id, ref, customer.id, vehicleId, input.service, input.description?.trim() || null, input.preferred_date || null,
    input.location, input.location === "mobile" ? input.address?.trim() || null : null,
    input.source, input.lead_id || null, actorId, t, t,
  );
  await audit(env, actorId, "booking.create", "booking", id, { ref, source: input.source, service: input.service });

  const to = customer.email ? { channel: "email" as const, to: customer.email } : customer.phone ? { channel: "sms" as const, to: customer.phone } : null;
  if (to) {
    try {
      await queueMessage(env, {
        ...to, template: "booking.received", entity: "booking", entityId: id,
        payload: { ref, name: customer.name, service: input.service, preferred_date: input.preferred_date || null },
      });
    } catch (err) { console.warn("booking: notification not queued", ref, err); }
  }

  if (input.lead_id) {
    try { await markLeadBooked(env, input.lead_id, id); }
    catch (err) { console.warn("booking: lead not marked as booked", input.lead_id, err); }
  }

  return (await getBooking(env, id))!;
}

export async function getBooking(env: Env, id: string): Promise<BookingRow | null> {
  return first<BookingRow>(env, "SELECT * FROM bookings WHERE id = ?", id);
}

/** Moves a booking to a new status (validated transitions). Jobs call this when work starts or finishes. Same status is a no-op. */
export async function setBookingStatus(env: Env, id: string, status: BookingStatus, actorId: string | null): Promise<BookingRow> {
  const b = await getBooking(env, id);
  if (!b) throw notFound("Booking");
  if (b.status === status) return b;
  if (!canTransition(b.status, status)) throw conflict(`A booking that is ${STATUS_LABELS[b.status]} can't be marked ${STATUS_LABELS[status]}.`);
  // Guard against a concurrent change: only move it from the status we checked.
  const res = await run(env, "UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND status = ?", status, now(), id, b.status);
  if (!res.meta.changes) throw conflict("This booking was changed by someone else. Reload and try again.");
  await audit(env, actorId, "booking.status", "booking", id, { from: b.status, to: status });
  return (await getBooking(env, id))!;
}

/** Confirms (or reschedules) a booking for a slot and queues the confirmation message. */
export async function confirmBooking(env: Env, id: string, start: string, end: string, actorId: string | null): Promise<BookingRow> {
  const b = await getBooking(env, id);
  if (!b) throw notFound("Booking");
  if (b.status !== "confirmed" && !canTransition(b.status, "confirmed")) throw conflict(`A booking that is ${STATUS_LABELS[b.status]} can't be confirmed.`);
  await run(env, "UPDATE bookings SET status = 'confirmed', scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ?", start, end, now(), id);
  await audit(env, actorId, b.status === "confirmed" ? "booking.reschedule" : "booking.confirm", "booking", id, { from: b.status, scheduled_start: start, scheduled_end: end });

  const customer = await getCustomer(env, b.customer_id);
  const to = customer?.email ? { channel: "email" as const, to: customer.email } : customer?.phone ? { channel: "sms" as const, to: customer.phone } : null;
  if (to && customer) {
    try {
      await queueMessage(env, {
        ...to, template: "booking.confirmed", entity: "booking", entityId: id,
        payload: { ref: b.ref, name: customer.name, service: b.service, scheduled_start: start, scheduled_end: end, location: b.location, address: b.address },
      });
    } catch (err) { console.warn("booking: confirmation not queued", b.ref, err); }
  }
  return (await getBooking(env, id))!;
}
