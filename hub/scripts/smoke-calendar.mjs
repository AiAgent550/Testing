// End-to-end checks for the calendar: jobs booked onto days, flags, rescheduling, days off and notes.
import { checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("calendar");
const call = await signIn();

const job = await call("/api/jobs", { method: "POST", body: { title: "Timing chain", reg: "HW65KBU", scheduled_date: "2026-11-17", scheduled_time: "09:30", duration_days: 2 } });
check("job created on a day", job.status === 201 && job.data.job.scheduled_date === "2026-11-17" && job.data.job.duration_days === 2, job.data);
const J = job.data.job.id;
const badTime = await call("/api/jobs", { method: "POST", body: { title: "X", scheduled_date: "2026-11-17", scheduled_time: "9.30" } });
check("bad time refused", badTime.status === 400);

const week = await call("/api/calendar?from=2026-11-16&to=2026-11-22");
check("week shows the job", week.status === 200 && week.data.jobs.some(j => j.id === J && Array.isArray(j.flags)), week.data);
const nextWeek = await call("/api/calendar?from=2026-11-18&to=2026-11-24");
check("two-day job shows on its second day", nextWeek.data.jobs.some(j => j.id === J));
const tooLong = await call("/api/calendar?from=2026-01-01&to=2026-06-01");
check("huge ranges refused", tooLong.status === 400);

const flags = await call(`/api/jobs/${J}`, { method: "PATCH", body: { flags: ["customer_informed", "parts_ordered", "nonsense"] } });
check("flags saved in order", flags.status === 200 && flags.data.job.flags === '["parts_ordered","customer_informed"]', flags.data);
const moved = await call(`/api/jobs/${J}`, { method: "PATCH", body: { scheduled_date: "2026-11-19" } });
check("job rescheduled", moved.data.job.scheduled_date === "2026-11-19" && moved.data.job.scheduled_time === "09:30");
const detail = await call(`/api/jobs/${J}`);
const notes = detail.data.notes.map(n => n.body);
check("flags and the move are written as notes", notes.includes("Parts ordered") && notes.includes("Customer informed") && notes.includes("Rescheduled to 19 Nov 2026"), notes);
check("detail returns flags as a list", JSON.stringify(detail.data.job.flags) === '["parts_ordered","customer_informed"]');

const unscheduledBefore = await call("/api/jobs?status=active&unscheduled=1");
check("scheduled job not in the unscheduled list", !unscheduledBefore.data.jobs.some(j => j.id === J));
const off = await call(`/api/jobs/${J}`, { method: "PATCH", body: { scheduled_date: null } });
check("taken off the calendar", off.data.job.scheduled_date === null && off.data.job.scheduled_time === null);
const unscheduled = await call("/api/jobs?status=active&unscheduled=1");
check("now listed as unscheduled", unscheduled.data.jobs.some(j => j.id === J));

const dayOff = await call("/api/calendar/entries", { method: "POST", body: { kind: "off", start_date: "2026-12-24", end_date: "2026-12-27", title: "Christmas" } });
check("days off added", dayOff.status === 201 && dayOff.data.entry.end_date === "2026-12-27", dayOff.data);
const backwards = await call("/api/calendar/entries", { method: "POST", body: { kind: "off", start_date: "2026-12-24", end_date: "2026-12-20" } });
check("end before start refused", backwards.status === 400);
const emptyNote = await call("/api/calendar/entries", { method: "POST", body: { kind: "note", start_date: "2026-12-01" } });
check("note needs text", emptyNote.status === 400);
const note = await call("/api/calendar/entries", { method: "POST", body: { kind: "note", start_date: "2026-12-26", title: "Parts delivery" } });
const dec = await call("/api/calendar?from=2026-12-21&to=2026-12-27");
check("days off and notes show in range", dec.data.entries.length === 2, dec.data.entries);
const edit = await call(`/api/calendar/entries/${dayOff.data.entry.id}`, { method: "PATCH", body: { end_date: "2026-12-28" } });
check("day off extended", edit.data.entry.end_date === "2026-12-28");
const del = await call(`/api/calendar/entries/${note.data.entry.id}`, { method: "DELETE" });
check("note deleted", del.status === 200);

done();
