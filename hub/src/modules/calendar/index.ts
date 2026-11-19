// Module: calendar. One read of everything on a range of days (jobs booked in, confirmed bookings without a job yet,
// days off and day notes), plus the days-off/notes themselves. Jobs are moved by the jobs module (PATCH /api/jobs/:id).
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, first, newId, now, run } from "../../lib/db";
import { badRequest, json, notFound } from "../../lib/http";
import { isoDate, nullable, oneOf, optional, parse, str } from "../../lib/validate";
import { parseFlags, ukDay } from "../jobs/schedule";

const MAX_RANGE_DAYS = 62;

function range(ctx: Ctx): { from: string; to: string } {
  const { from, to } = parse({ from: ctx.url.searchParams.get("from"), to: ctx.url.searchParams.get("to") }, { from: isoDate(), to: isoDate() });
  const days = (Date.parse(to) - Date.parse(from)) / 864e5;
  if (days < 0 || days > MAX_RANGE_DAYS) throw badRequest("Pick a range of up to two months.");
  return { from, to };
}

async function calendar(ctx: Ctx) {
  const { env } = ctx;
  const { from, to } = range(ctx);
  const [jobs, bookings, entries, users] = await Promise.all([
    all<{ flags: string } & Record<string, unknown>>(env,
      `SELECT j.id, j.ref, j.title, j.status, j.scheduled_date, j.scheduled_time, j.duration_days, j.flags, j.assigned_to,
              v.reg, v.make, v.model, v.year, c.name AS customer_name, c.phone AS customer_phone, u.name AS assignee_name,
              (SELECT n.body FROM job_notes n WHERE n.job_id = j.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS last_note
         FROM jobs j
         LEFT JOIN vehicles v ON v.id = j.vehicle_id
         LEFT JOIN customers c ON c.id = j.customer_id
         LEFT JOIN users u ON u.id = j.assigned_to
        WHERE j.scheduled_date IS NOT NULL AND j.status != 'cancelled'
          AND j.scheduled_date <= ? AND date(j.scheduled_date, '+' || (j.duration_days - 1) || ' days') >= ?
        ORDER BY j.scheduled_date, j.scheduled_time IS NULL, j.scheduled_time, j.ref`, to, from),
    // Bookings that are confirmed (or asked for a day) but have no job card yet, so nothing is missed.
    all<{ scheduled_start: string | null; preferred_date: string | null } & Record<string, unknown>>(env,
      `SELECT b.id, b.ref, b.service, b.status, b.scheduled_start, b.preferred_date, b.location, v.reg, v.make, v.model, c.name AS customer_name
         FROM bookings b
         LEFT JOIN vehicles v ON v.id = b.vehicle_id
         LEFT JOIN customers c ON c.id = b.customer_id
        WHERE b.status IN ('requested','confirmed')
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.booking_id = b.id AND j.status != 'cancelled')
          AND COALESCE(substr(b.scheduled_start, 1, 10), b.preferred_date) BETWEEN date(?, '-1 day') AND date(?, '+1 day')`, from, to),
    all(env,
      `SELECT e.id, e.kind, e.start_date, e.end_date, e.title, e.user_id, u.name AS user_name
         FROM calendar_entries e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date, e.kind`, to, from),
    all(env, "SELECT id, name FROM users ORDER BY name COLLATE NOCASE"),
  ]);
  return json({
    from, to,
    jobs: jobs.map(j => ({ ...j, flags: parseFlags(j.flags) })),
    bookings: bookings
      .map(b => ({ ...b, day: ukDay(b.scheduled_start) ?? b.preferred_date, confirmed: !!b.scheduled_start }))
      .filter(b => b.day && b.day >= from && b.day <= to),
    entries, users,
  });
}

const ENTRY_SHAPE = {
  kind: oneOf(["off", "note"] as const),
  start_date: isoDate(),
  end_date: optional(isoDate()),
  title: optional(str({ max: 200 })),
  user_id: nullable(str({ max: 64 })),
};

async function checkUser(ctx: Ctx, id: string | null | undefined) {
  if (id && !(await first(ctx.env, "SELECT 1 AS ok FROM users WHERE id = ?", id))) throw badRequest("Some fields need fixing.", { user_id: "Pick someone from the list." });
}

async function createEntry(ctx: Ctx) {
  const user = userOf(ctx);
  const input = parse(await ctx.body(), ENTRY_SHAPE);
  const end = input.end_date ?? input.start_date;
  if (end < input.start_date) throw badRequest("Some fields need fixing.", { end_date: "The last day can't be before the first." });
  if (input.kind === "note" && !input.title) throw badRequest("Some fields need fixing.", { title: "Required." });
  await checkUser(ctx, input.user_id);
  const id = newId("cal"), t = now();
  const title = input.title ?? "Day off";
  await run(ctx.env, "INSERT INTO calendar_entries (id, kind, start_date, end_date, title, user_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, input.kind, input.start_date, end, title, input.user_id ?? null, user.id, t, t);
  await audit(ctx.env, user.id, `calendar.${input.kind}_add`, "calendar_entry", id, { start: input.start_date, end, user_id: input.user_id ?? null });
  return json({ entry: await first(ctx.env, "SELECT * FROM calendar_entries WHERE id = ?", id) }, 201);
}

async function updateEntry(ctx: Ctx) {
  const user = userOf(ctx);
  const e = await first<{ id: string; kind: string; start_date: string; end_date: string; title: string; user_id: string | null }>(ctx.env, "SELECT * FROM calendar_entries WHERE id = ?", ctx.params.id);
  if (!e) throw notFound("Calendar entry");
  const input = parse(await ctx.body(), { ...ENTRY_SHAPE, kind: optional(oneOf(["off", "note"] as const)), start_date: optional(isoDate()) });
  await checkUser(ctx, input.user_id);
  const start = input.start_date ?? e.start_date, end = input.end_date ?? (input.start_date && e.end_date < input.start_date ? input.start_date : e.end_date);
  if (end < start) throw badRequest("Some fields need fixing.", { end_date: "The last day can't be before the first." });
  await run(ctx.env, "UPDATE calendar_entries SET kind = ?, start_date = ?, end_date = ?, title = ?, user_id = ?, updated_at = ? WHERE id = ?",
    input.kind ?? e.kind, start, end, input.title ?? e.title, input.user_id === undefined ? e.user_id : input.user_id, now(), e.id);
  await audit(ctx.env, user.id, "calendar.update", "calendar_entry", e.id, { start, end });
  return json({ entry: await first(ctx.env, "SELECT * FROM calendar_entries WHERE id = ?", e.id) });
}

async function deleteEntry(ctx: Ctx) {
  const e = await first<{ id: string; kind: string; title: string }>(ctx.env, "SELECT id, kind, title FROM calendar_entries WHERE id = ?", ctx.params.id);
  if (!e) throw notFound("Calendar entry");
  await run(ctx.env, "DELETE FROM calendar_entries WHERE id = ?", e.id);
  await audit(ctx.env, userOf(ctx).id, "calendar.delete", "calendar_entry", e.id, { kind: e.kind, title: e.title });
  return json({ ok: true });
}

const calendarModule: Module = {
  name: "calendar",
  register(r) {
    r.get("/api/calendar", calendar);
    r.post("/api/calendar/entries", createEntry);
    r.patch("/api/calendar/entries/:id", updateEntry);
    r.delete("/api/calendar/entries/:id", deleteEntry);
  },
};
export default calendarModule;
