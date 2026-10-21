// Module: bookings. Staff routes for the bookings list and detail, plus the website's public endpoints.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { BOOKING_STATUSES, SERVICES, type BookingStatus } from "../../lib/types";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, first, now, run, updateSet } from "../../lib/db";
import { badRequest, json, notFound } from "../../lib/http";
import { email, isoDate, isoDateTime, nullable, oneOf, optional, parse, reg, str, ukPhone } from "../../lib/validate";
import { getSetting } from "../system";
import { getCustomer } from "../customers/service";
import { getVehicle, publicVehicle } from "../vehicles/service";
import { likeEscape, phoneSearchDigits } from "../customers/match";
import { confirmBooking, createBooking, getBooking, setBookingStatus } from "./service";
import { TRANSITIONS } from "./status";
import { preflight, publicBooking, publicVehicle as publicVehicleLookup } from "./public";

const LIST_SELECT = `
  SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, v.reg, v.make, v.model, v.colour,
         (SELECT j.id FROM jobs j WHERE j.booking_id = b.id ORDER BY j.created_at LIMIT 1) AS job_id
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id`;

async function list(ctx: Ctx) {
  const sp = ctx.url.searchParams;
  const where: string[] = [], params: unknown[] = [];

  const statuses = (sp.get("status") || "").split(",").map(s => s.trim()).filter(Boolean);
  for (const s of statuses) if (!BOOKING_STATUSES.includes(s as BookingStatus)) throw badRequest("Unknown status.", { status: `Unknown status: ${s}` });
  if (statuses.length) { where.push(`b.status IN (${statuses.map(() => "?").join(", ")})`); params.push(...statuses); }

  const dates = parse({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }, { from: optional(isoDate()), to: optional(isoDate()) });
  const day = "substr(COALESCE(b.scheduled_start, b.preferred_date, b.created_at), 1, 10)";
  if (dates.from) { where.push(`${day} >= ?`); params.push(dates.from); }
  if (dates.to) { where.push(`${day} <= ?`); params.push(dates.to); }

  const q = (sp.get("q") || "").trim().slice(0, 80);
  if (q) {
    const like = `%${likeEscape(q)}%`;
    const regQ = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const digits = phoneSearchDigits(q);
    where.push(`(c.name LIKE ? ESCAPE '\\' OR b.ref LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'
                 OR (? != '' AND v.reg LIKE ? ESCAPE '\\') OR (? IS NOT NULL AND c.phone LIKE ?))`);
    params.push(like, like, like, regQ, `%${regQ}%`, digits, `%${digits ?? ""}%`);
  }

  const rows = await all(
    ctx.env,
    `${LIST_SELECT}
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY CASE WHEN b.status = 'requested' THEN 0 ELSE 1 END,
              CASE WHEN b.status = 'requested' THEN b.created_at END ASC,
              b.scheduled_start IS NULL, b.scheduled_start ASC, b.created_at DESC
     LIMIT 200`,
    ...params,
  );
  return json({ bookings: rows });
}

async function detail(ctx: Ctx) {
  const b = await getBooking(ctx.env, ctx.params.id);
  if (!b) throw notFound("Booking");
  const [customer, vehicle, job] = await Promise.all([
    getCustomer(ctx.env, b.customer_id),
    b.vehicle_id ? getVehicle(ctx.env, b.vehicle_id) : Promise.resolve(null),
    first(ctx.env, "SELECT id, ref, title, status, created_at FROM jobs WHERE booking_id = ? ORDER BY created_at LIMIT 1", b.id),
  ]);
  return json({ booking: b, customer, vehicle: vehicle ? publicVehicle(vehicle) : null, job, transitions: TRANSITIONS[b.status] });
}

async function create(ctx: Ctx) {
  const input = parse(await ctx.body(), {
    name: str({ max: 120 }),
    phone: optional(ukPhone()),
    email: optional(email()),
    reg: optional(reg()),
    service: oneOf(SERVICES),
    description: optional(str({ max: 2000 })),
    preferred_date: optional(isoDate()),
    location: optional(oneOf(["workshop", "mobile"] as const)),
    address: optional(str({ max: 300 })),
    source: optional(oneOf(["phone", "walk_in", "other"] as const)),
    lead_id: optional(str({ max: 64 })),
  });
  const location = input.location ?? "workshop";
  if (location === "mobile" && !input.address) throw badRequest("Some fields need fixing.", { address: "Add the address for a mobile visit." });
  const booking = await createBooking(ctx.env, {
    customer: { name: input.name, phone: input.phone ?? null, email: input.email ?? null },
    reg: input.reg ?? null, service: input.service, description: input.description ?? null,
    preferred_date: input.preferred_date ?? null, location, address: input.address ?? null,
    source: input.source ?? "phone", lead_id: input.lead_id ?? null,
  }, userOf(ctx).id);
  return json({ booking }, 201);
}

async function update(ctx: Ctx) {
  const b = await getBooking(ctx.env, ctx.params.id);
  if (!b) throw notFound("Booking");
  const patch = parse(await ctx.body(), {
    description: nullable(str({ max: 2000 })),
    internal_notes: nullable(str({ max: 4000 })),
    location: optional(oneOf(["workshop", "mobile"] as const)),
    address: nullable(str({ max: 300 })),
    preferred_date: nullable(isoDate()),
    service: optional(oneOf(SERVICES)),
  });
  const location = patch.location ?? b.location;
  const address = patch.address !== undefined ? patch.address : b.address;
  if (location === "mobile" && !address) throw badRequest("Some fields need fixing.", { address: "Add the address for a mobile visit." });
  const set = updateSet(patch, ["description", "internal_notes", "location", "address", "preferred_date", "service"]);
  if (set.sql) {
    await run(ctx.env, `UPDATE bookings SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, now(), b.id);
    await audit(ctx.env, userOf(ctx).id, "booking.update", "booking", b.id, { fields: Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined) });
  }
  return json({ booking: await getBooking(ctx.env, b.id) });
}

async function confirm(ctx: Ctx) {
  const input = parse(await ctx.body(), { scheduled_start: isoDateTime(), scheduled_end: optional(isoDateTime()) });
  let end = input.scheduled_end;
  if (!end) {
    const { slotMinutes } = await getSetting<{ slotMinutes?: number }>(ctx.env, "booking");
    end = new Date(Date.parse(input.scheduled_start) + (Number(slotMinutes) || 120) * 60_000).toISOString();
  }
  if (Date.parse(end) <= Date.parse(input.scheduled_start)) throw badRequest("Some fields need fixing.", { scheduled_end: "The end has to be after the start." });
  const booking = await confirmBooking(ctx.env, ctx.params.id, input.scheduled_start, end, userOf(ctx).id);
  return json({ booking });
}

async function status(ctx: Ctx) {
  const { status: next } = parse(await ctx.body(), { status: oneOf(BOOKING_STATUSES) });
  const b = await getBooking(ctx.env, ctx.params.id);
  if (!b) throw notFound("Booking");
  if (next === "confirmed" && b.status === "requested") throw badRequest("Pick a date and time to confirm this booking.", { status: "Use Confirm to choose a time." });
  return json({ booking: await setBookingStatus(ctx.env, b.id, next, userOf(ctx).id) });
}

const bookings: Module = {
  name: "bookings",
  register(r) {
    r.get("/api/bookings", list);
    r.post("/api/bookings", create);
    r.get("/api/bookings/:id", detail);
    r.patch("/api/bookings/:id", update);
    r.post("/api/bookings/:id/confirm", confirm);
    r.post("/api/bookings/:id/status", status);

    r.add("OPTIONS", "/api/public/bookings", preflight, "public");
    r.post("/api/public/bookings", publicBooking, "public");
    r.add("OPTIONS", "/api/public/vehicle/:reg", preflight, "public");
    r.get("/api/public/vehicle/:reg", publicVehicleLookup, "public");
  },
};
export default bookings;
