// Module: jobs. Job cards for the workshop: status, assignee, mileage/VIN, notes and photos.
// Logic other modules may call lives in service.ts.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import type { JobRow, JobStatus } from "../../lib/types";
import { JOB_STATUSES } from "../../lib/types";
import { audit } from "../../lib/audit";
import { all, first, newId, nextRef, now, run, updateSet } from "../../lib/db";
import { HttpError, badRequest, forbidden, json, notFound } from "../../lib/http";
import { int, isoDate, nullable, oneOf, optional, parse, reg, str, vin } from "../../lib/validate";
import { FLAG_NOTES, cleanFlags, noteDay, parseFlags } from "./schedule";
import { setBookingStatus } from "../bookings/service";
import { changeRegistration, ensureVehicle, publicVehicle, retitleForReg, updateVehicle } from "../vehicles/service";
import { latestSuggestion } from "../ai/service";
import { notify } from "../notifications";
import { sendStaffAlert } from "../notifications/alerts";
import { engineLabel } from "../vehicles/names";
import { formatReg, getJob, openJobForBooking, readVehicle, soft } from "./service";
import { ACTIVE_STATUSES, canTransition, transitionStamps } from "./status";
import { serveStored } from "../../lib/storage";
import { ALLOWED_DECLARED, MAX_PHOTO_BYTES, MAX_PREVIEW_BYTES, MAX_VIDEO_BYTES, VIDEO_DECLARED, sniffImage, sniffVideo } from "./files";

const id = (prefix: string) => (v: unknown, f: string) => {
  const s = str({ max: 64 })(v, f);
  if (!s.startsWith(`${prefix}_`)) throw badRequest("Some fields need fixing.", { [f]: "Not a valid id." });
  return s;
};

const hhmm = () => (v: unknown, f: string) => {
  const s = str({ max: 5 })(v, f);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw badRequest("Some fields need fixing.", { [f]: "Use a time like 09:30." });
  return s;
};

async function mustGetJob(ctx: Ctx): Promise<JobRow> {
  const job = await getJob(ctx.env, ctx.params.id);
  if (!job) throw notFound("Job");
  return job;
}

// ---------- list and detail ----------
const LIST_SQL = `
  SELECT j.id, j.ref, j.title, j.status, j.assigned_to, j.booking_id, j.customer_id, j.vehicle_id, j.mileage,
         j.scheduled_date, j.scheduled_time, j.duration_days, j.flags,
         j.started_at, j.completed_at, j.created_at, j.updated_at,
         v.reg, v.make, v.model, v.year,
         c.name AS customer_name, c.phone AS customer_phone,
         u.name AS assignee_name
    FROM jobs j
    LEFT JOIN vehicles v ON v.id = j.vehicle_id
    LEFT JOIN customers c ON c.id = j.customer_id
    LEFT JOIN users u ON u.id = j.assigned_to`;
const ORDER = `ORDER BY CASE j.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'waiting_parts' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
         CASE WHEN j.status = 'completed' THEN j.completed_at END DESC, j.updated_at DESC`;

async function listJobs(ctx: Ctx) {
  const q = ctx.url.searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const status = q.get("status") || "";
  if (status) {
    const wanted = status === "active" ? [...ACTIVE_STATUSES] : status.split(",").map(s => s.trim()).filter(Boolean);
    if (!wanted.length || wanted.some(s => !JOB_STATUSES.includes(s as JobStatus))) throw badRequest("Unknown status filter.", { status: `Use active or: ${JOB_STATUSES.join(", ")}.` });
    where.push(`j.status IN (${wanted.map(() => "?").join(", ")})`);
    params.push(...wanted);
  }
  if (q.get("mine") === "1") { where.push("j.assigned_to = ?"); params.push(userOf(ctx).id); }
  if (q.get("unscheduled") === "1") where.push("j.scheduled_date IS NULL");
  const sql = `${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""} ${ORDER} LIMIT 200`;
  return json({ jobs: await all(ctx.env, sql, ...params) });
}

async function jobDetail(ctx: Ctx) {
  const { env } = ctx;
  const job = await mustGetJob(ctx);
  // Read-only joins for display; changes to these records always go through their own modules.
  const [customer, vehicle, booking, notes, files, suggestion, assignee] = await Promise.all([
    job.customer_id ? first(env, "SELECT id, name, phone, email FROM customers WHERE id = ?", job.customer_id) : null,
    readVehicle(env, job.vehicle_id),
    job.booking_id ? first(env, "SELECT id, ref, service, status, description, preferred_date, scheduled_start, scheduled_end, location FROM bookings WHERE id = ?", job.booking_id) : null,
    all(env, "SELECT n.id, n.body, n.created_at, n.edited_at, n.user_id, u.name AS author_name FROM job_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.job_id = ? ORDER BY n.created_at, n.id", job.id),
    all<{ id: string; preview_key: string | null }>(env, "SELECT id, kind, content_type, size, preview_key, preview_size, filename, caption, uploaded_by, created_at FROM job_files WHERE job_id = ? ORDER BY created_at, id", job.id),
    latestSuggestion(env, job.id),
    job.assigned_to ? first<{ name: string }>(env, "SELECT name FROM users WHERE id = ?", job.assigned_to) : null,
  ]);
  const v = vehicle ? publicVehicle(vehicle) : null;
  return json({
    job: { ...job, flags: parseFlags(job.flags), assignee_name: assignee?.name ?? null },
    customer, vehicle: v, booking,
    notes: (notes as { user_id: string | null }[]).map(n => ({ ...n, mine: n.user_id === userOf(ctx).id })),
    files: files.map(({ preview_key, ...f }) => fileView(job.id, { ...f, preview_key })),
    suggestion,
  });
}

// ---------- email to the workshop inbox ([JOB] ...) ----------
/** Sends "[JOB] J-2016 · Timing chain · HW65 KBU" to the business mailbox with the job's details and a link
 *  that opens the job in the Hub. Runs after the response; never fails the request. */
function jobAlert(ctx: Ctx, jobId: string, event: "new" | "completed") {
  const { env } = ctx;
  const actor = userOf(ctx).name;
  const send = async () => {
    const job = await getJob(env, jobId);
    if (!job) return;
    const [v, c, booking, assignee] = await Promise.all([
      readVehicle(env, job.vehicle_id),
      job.customer_id ? first<{ name: string; phone: string | null; email: string | null }>(env, "SELECT name, phone, email FROM customers WHERE id = ?", job.customer_id) : null,
      job.booking_id ? first<{ ref: string }>(env, "SELECT ref FROM bookings WHERE id = ?", job.booking_id) : null,
      job.assigned_to ? first<{ name: string }>(env, "SELECT name FROM users WHERE id = ?", job.assigned_to) : null,
    ]);
    const reg = v?.reg ? formatReg(v.reg) : null;
    const car = v ? [[v.make, v.model, v.year].filter(Boolean).join(" "), [engineLabel(v.make, v.engine_cc, v.fuel_type), v.colour].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : null;
    const phone = c?.phone?.startsWith("+44") ? "0" + c.phone.slice(3) : c?.phone ?? null;
    const day = job.scheduled_date ? `${noteDay(job.scheduled_date)}${job.scheduled_time ? ` at ${job.scheduled_time}` : ""}${job.duration_days > 1 ? ` (${job.duration_days} days)` : ""}` : "Not on the calendar yet";
    const flags = parseFlags(job.flags).map(f => FLAG_NOTES[f]).join(", ");
    await sendStaffAlert(env, {
      kind: "JOB",
      subject: [job.ref, event === "completed" ? "Completed" : null, job.title.split(" · ")[0], reg],
      lines: [
        ["Job", `${job.ref}${event === "completed" ? " (completed)" : ""}`], ["What", job.title], ["Registration", reg], ["Vehicle", car],
        ["Customer", c?.name ?? null], ["Phone", phone], ["Email", c?.email ?? null],
        ["Booked in", day], ["Booking", booking?.ref ?? null], ["Issue", job.description], ["Status", flags || null],
        ["Assigned to", assignee?.name ?? null], [event === "completed" ? "Completed by" : "Created by", actor],
      ],
      link: `${env.APP_ORIGIN}/app/#/jobs/${job.id}`,
      button: "Open job",
    });
  };
  ctx.exec.waitUntil(send().catch(err => console.warn("job alert failed", err)));
}

// ---------- create ----------
async function createJob(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const input = parse(await ctx.body(), {
    title: str({ max: 200 }),
    description: optional(str({ max: 4000 })),
    customer_id: optional(id("cus")),
    vehicle_id: optional(id("veh")),
    reg: optional(reg()),
    scheduled_date: optional(isoDate()),
    scheduled_time: optional(hhmm()),
    duration_days: optional(int({ min: 1, max: 30 })),
  });
  if (input.customer_id && !(await first(env, "SELECT 1 AS ok FROM customers WHERE id = ?", input.customer_id))) {
    throw badRequest("Some fields need fixing.", { customer_id: "That customer wasn't found." });
  }
  let vehicleId: string | null = null;
  if (input.vehicle_id) {
    if (!(await first(env, "SELECT 1 AS ok FROM vehicles WHERE id = ?", input.vehicle_id))) throw badRequest("Some fields need fixing.", { vehicle_id: "That vehicle wasn't found." });
    vehicleId = input.vehicle_id;
  } else if (input.reg) {
    const v = await soft("vehicles.ensureVehicle", () => ensureVehicle(env, input.reg!, input.customer_id ?? null, user.id));
    vehicleId = v?.id ?? (await first<{ id: string }>(env, "SELECT id FROM vehicles WHERE reg = ?", input.reg))?.id ?? null;
  }
  // If the car couldn't be linked yet, keep the registration in the title so it isn't lost.
  let title = input.title;
  if (input.reg && !vehicleId && !title.toUpperCase().replace(/\s/g, "").includes(input.reg)) title = `${title} · ${formatReg(input.reg)}`.slice(0, 220);

  const jobId = newId("job");
  const ref = await nextRef(env, "job_ref", "J");
  const t = now();
  await run(env,
    `INSERT INTO jobs (id, ref, customer_id, vehicle_id, title, description, status, scheduled_date, scheduled_time, duration_days, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
    jobId, ref, input.customer_id ?? null, vehicleId, title, input.description ?? null,
    input.scheduled_date ?? null, input.scheduled_date ? input.scheduled_time ?? null : null, input.duration_days ?? 1, user.id, t, t);
  await audit(env, user.id, "job.create", "job", jobId, { ref, vehicle_id: vehicleId, customer_id: input.customer_id ?? null });
  await notify(env, { kind: "job_new", actorId: user.id, link: `#/jobs/${jobId}`, tag: `job-${jobId}`, params: { ref, title, actor: user.name } }, ctx.exec);
  jobAlert(ctx, jobId, "new");
  return json({ job: await getJob(env, jobId) }, 201);
}

async function createFromBooking(ctx: Ctx) {
  const user = userOf(ctx);
  const { job, created } = await openJobForBooking(ctx.env, ctx.params.bookingId, user.id);
  if (created) {
    await notify(ctx.env, { kind: "job_new", actorId: user.id, link: `#/jobs/${job.id}`, tag: `job-${job.id}`, params: { ref: job.ref, title: job.title, actor: user.name } }, ctx.exec);
    jobAlert(ctx, job.id, "new");
  }
  return json({ job, created }, created ? 201 : 200);
}

// ---------- update ----------
async function updateJob(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const job = await mustGetJob(ctx);
  const input = parse(await ctx.body(), {
    title: optional(str({ max: 220 })),
    description: nullable(str({ max: 4000 })),
    status: optional(oneOf(JOB_STATUSES)),
    assigned_to: nullable(str({ max: 64 })),
    mileage: nullable(int({ min: 0, max: 999999 })),
    reg: nullable(reg()),
    customer_id: nullable(id("cus")),
    scheduled_date: nullable(isoDate()),
    scheduled_time: nullable(hhmm()),
    duration_days: optional(int({ min: 1, max: 30 })),
  });
  const rawBody = (await ctx.body()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    title: input.title, description: input.description, mileage: input.mileage,
    scheduled_date: input.scheduled_date, scheduled_time: input.scheduled_date === null ? null : input.scheduled_time, duration_days: input.duration_days,
  };
  // Quick status flags: switching one on writes a note, so the job's history shows who did what and when.
  const notesToAdd: string[] = [];
  if (rawBody.flags !== undefined) {
    const before = parseFlags(job.flags), after = cleanFlags(rawBody.flags);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      patch.flags = JSON.stringify(after);
      for (const f of after) if (!before.includes(f)) notesToAdd.push(FLAG_NOTES[f]);
    }
  }
  if (input.scheduled_date !== undefined && input.scheduled_date !== job.scheduled_date) {
    notesToAdd.push(input.scheduled_date ? (job.scheduled_date ? `Rescheduled to ${noteDay(input.scheduled_date)}` : `Booked in for ${noteDay(input.scheduled_date)}`) : "Taken off the calendar");
  }
  const extraAudit: Record<string, unknown> = {};

  // Customer: relink the job (and its booking) to another existing customer.
  if (input.customer_id !== undefined && input.customer_id !== job.customer_id) {
    if (input.customer_id !== null && !(await first(env, "SELECT 1 AS ok FROM customers WHERE id = ?", input.customer_id))) {
      throw badRequest("Some fields need fixing.", { customer_id: "That customer wasn't found." });
    }
    patch.customer_id = input.customer_id;
    extraAudit.customer = { from: job.customer_id, to: input.customer_id };
  }

  // Registration: fix a typo, move to a car already in the Hub, or add a new car (see changeRegistration).
  let bookingVehicle: string | null | undefined;
  if (input.reg !== undefined) {
    const res = await changeRegistration(env, {
      currentVehicleId: job.vehicle_id, newReg: input.reg,
      jobIds: [job.id], bookingIds: job.booking_id ? [job.booking_id] : [],
      customerId: (patch.customer_id as string | null | undefined) ?? job.customer_id,
    }, user.id);
    if (res.outcome !== "unchanged") {
      if (res.vehicleId !== job.vehicle_id) patch.vehicle_id = res.vehicleId;
      patch.title = retitleForReg((input.title ?? job.title), res.oldReg, res.newReg);
      bookingVehicle = res.vehicleId;
      extraAudit.reg = { from: res.oldReg, to: res.newReg, outcome: res.outcome };
    }
  }
  if (input.assigned_to !== undefined) {
    if (input.assigned_to !== null && !(await first(env, "SELECT 1 AS ok FROM users WHERE id = ?", input.assigned_to))) {
      throw badRequest("Some fields need fixing.", { assigned_to: "Pick someone from the list." });
    }
    patch.assigned_to = input.assigned_to;
  }
  const t = now();
  const moving = input.status !== undefined && input.status !== job.status;
  if (moving) {
    if (!canTransition(job.status, input.status!)) {
      throw new HttpError(409, "invalid_transition", `A job that is ${job.status.replace("_", " ")} can't move to ${input.status!.replace("_", " ")}.`, { status: "Not allowed from the current status." });
    }
    patch.status = input.status;
    Object.assign(patch, transitionStamps(job, input.status!, t));
  }
  const { sql, params } = updateSet(patch, ["title", "description", "mileage", "assigned_to", "status", "started_at", "completed_at", "customer_id", "vehicle_id", "scheduled_date", "scheduled_time", "duration_days", "flags"]);
  if (!sql) return json({ job });
  await run(env, `UPDATE jobs SET ${sql}, updated_at = ? WHERE id = ?`, ...params, t, job.id);
  for (const body of notesToAdd) {
    await run(env, "INSERT INTO job_notes (id, job_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)", newId("jnt"), job.id, user.id, body, t);
  }
  if (notesToAdd.length) {
    await notify(env, { kind: "job_note", actorId: user.id, link: `#/jobs/${job.id}`, tag: `job-${job.id}-note`, params: { ref: job.ref, note: notesToAdd.join(" · "), actor: user.name } }, ctx.exec);
  }
  // Keep the booking pointing at the same car and customer as its job.
  if (job.booking_id) {
    const bset = updateSet({ vehicle_id: bookingVehicle, customer_id: patch.customer_id ?? undefined }, ["vehicle_id", "customer_id"]);
    if (bset.sql) await run(env, `UPDATE bookings SET ${bset.sql}, updated_at = ? WHERE id = ?`, ...bset.params, t, job.booking_id);
  }

  const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await audit(env, user.id, moving ? "job.status" : "job.update", "job", job.id, { ...changed, ...extraAudit, ...(moving ? { from: job.status } : {}) });
  if (moving && input.status === "completed" && job.booking_id) {
    await soft("bookings.setBookingStatus(completed)", () => setBookingStatus(env, job.booking_id!, "completed", user.id));
  }
  const updated = (await getJob(env, job.id))!;
  const about = { ref: job.ref, title: updated.title, actor: user.name };
  const STATUS_KIND = { in_progress: "job_started", completed: "job_completed", cancelled: "job_cancelled" } as const;
  if (moving && input.status === "completed") jobAlert(ctx, job.id, "completed");
  if (moving && input.status! in STATUS_KIND) {
    await notify(env, { kind: STATUS_KIND[input.status as keyof typeof STATUS_KIND], actorId: user.id, link: `#/jobs/${job.id}`, tag: `job-${job.id}`, params: about }, ctx.exec);
  }
  if (input.assigned_to && input.assigned_to !== job.assigned_to) {
    await notify(env, { kind: "job_assigned", actorId: user.id, onlyUserId: input.assigned_to, link: `#/jobs/${job.id}`, tag: `job-${job.id}-assigned`, params: about }, ctx.exec);
  }
  return json({ job: updated, reg_change: (extraAudit.reg as { outcome?: string } | undefined)?.outcome ?? null });
}

async function updateJobVehicle(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const job = await mustGetJob(ctx);
  const input = parse(await ctx.body(), { vin: nullable(vin()), mileage: nullable(int({ min: 0, max: 999999 })) });
  if (input.vin !== undefined && !job.vehicle_id) throw badRequest("Some fields need fixing.", { vin: "Link a car to this job before saving its VIN." });

  let vehicleUpdated = false;
  if (job.vehicle_id && (input.vin !== undefined || input.mileage !== undefined)) {
    const vpatch: { vin?: string | null; last_mileage?: number | null } = {};
    if (input.vin !== undefined) vpatch.vin = input.vin;
    if (input.mileage !== undefined && input.mileage !== null) vpatch.last_mileage = input.mileage;
    if (Object.keys(vpatch).length) vehicleUpdated = !!(await soft("vehicles.updateVehicle", () => updateVehicle(env, job.vehicle_id!, vpatch, user.id)));
  }
  if (input.mileage !== undefined) await run(env, "UPDATE jobs SET mileage = ?, updated_at = ? WHERE id = ?", input.mileage, now(), job.id);
  await audit(env, user.id, "job.vehicle_details", "job", job.id, { vin: input.vin, mileage: input.mileage, vehicle_updated: vehicleUpdated });
  return json({ job: await getJob(env, job.id), vehicle: await readVehicle(env, job.vehicle_id), vehicle_updated: vehicleUpdated });
}

// ---------- notes ----------
async function addNote(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const job = await mustGetJob(ctx);
  const { body } = parse(await ctx.body(), { body: str({ max: 4000 }) });
  const noteId = newId("jnt");
  const t = now();
  await run(env, "INSERT INTO job_notes (id, job_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)", noteId, job.id, user.id, body, t);
  await run(env, "UPDATE jobs SET updated_at = ? WHERE id = ?", t, job.id);
  await audit(env, user.id, "job.note_add", "job", job.id, { note_id: noteId });
  await notify(env, { kind: "job_note", actorId: user.id, link: `#/jobs/${job.id}`, tag: `job-${job.id}-note`, params: { ref: job.ref, note: body, actor: user.name } }, ctx.exec);
  return json({ note: { id: noteId, body, created_at: t, user_id: user.id, author_name: user.name } }, 201);
}

interface NoteRow { id: string; job_id: string; user_id: string | null; body: string; created_at: string; edited_at: string | null }

/** Only the person who wrote a note can change or remove it. */
async function mustOwnNote(ctx: Ctx): Promise<NoteRow> {
  const note = await first<NoteRow>(ctx.env, "SELECT * FROM job_notes WHERE id = ? AND job_id = ?", ctx.params.noteId, ctx.params.id);
  if (!note) throw notFound("Note");
  if (note.user_id !== userOf(ctx).id) throw forbidden("You can only change your own notes.");
  return note;
}

async function editNote(ctx: Ctx) {
  const { env } = ctx;
  const note = await mustOwnNote(ctx);
  const { body } = parse(await ctx.body(), { body: str({ max: 4000 }) });
  if (body === note.body) return json({ note });
  const t = now();
  await run(env, "UPDATE job_notes SET body = ?, edited_at = ? WHERE id = ?", body, t, note.id);
  await audit(env, userOf(ctx).id, "job.note_edit", "job", note.job_id, { note_id: note.id, before: note.body, after: body });
  return json({ note: { ...note, body, edited_at: t } });
}

async function deleteNote(ctx: Ctx) {
  const { env } = ctx;
  const note = await mustOwnNote(ctx);
  await run(env, "DELETE FROM job_notes WHERE id = ?", note.id);
  await audit(env, userOf(ctx).id, "job.note_delete", "job", note.job_id, { note_id: note.id, before: note.body });
  return json({ ok: true });
}

// ---------- photos ----------
async function uploadFile(ctx: Ctx) {
  const { env, req } = ctx;
  const user = userOf(ctx);
  const job = await mustGetJob(ctx);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_PHOTO_BYTES + 64 * 1024) throw new HttpError(413, "too_large", "Photos can be up to 10 MB.");
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) throw badRequest("Send the photo as a form upload.");

  let form: FormData;
  try { form = await req.formData(); }
  catch { throw badRequest("The upload couldn't be read. Try again."); }
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("Choose a photo to upload.", { file: "Required." });
  if (file.size === 0) throw badRequest("That file is empty.", { file: "Empty file." });
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, "too_large", "Photos can be up to 10 MB.");
  const declared = (file.type || "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || !ALLOWED_DECLARED.includes(declared)) {
    throw new HttpError(415, "unsupported_type", "Only photos can be uploaded (JPEG, PNG, WebP or HEIC).", { file: "Not a supported image." });
  }
  // A smaller JPEG made on the phone, used for thumbnails and email attachments.
  const previewPart = form.get("preview");
  let preview: Uint8Array | null = null;
  if (previewPart && typeof previewPart !== "string" && previewPart.size > 0 && previewPart.size <= MAX_PREVIEW_BYTES) {
    const pb = new Uint8Array(await previewPart.arrayBuffer());
    if (sniffImage(pb) === "image/jpeg") preview = pb;
  }
  const nameRaw = form.get("filename") ?? file.name;
  const filename = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim().slice(0, 120) : null;
  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim().slice(0, 200) : null;

  const fileId = newId("jfl");
  const key = `jobs/${job.id}/${fileId}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { job_id: job.id, uploaded_by: user.id } });
  const previewKey = preview ? `${key}.preview.jpg` : null;
  if (preview) await env.FILES.put(previewKey!, preview, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { job_id: job.id } });
  const t = now();
  await run(env, "INSERT INTO job_files (id, job_id, r2_key, kind, content_type, size, preview_key, preview_size, filename, caption, uploaded_by, created_at) VALUES (?, ?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?)",
    fileId, job.id, key, type, bytes.length, previewKey, preview?.length ?? null, filename, caption, user.id, t);
  await run(env, "UPDATE jobs SET updated_at = ? WHERE id = ?", t, job.id);
  await audit(env, user.id, "job.file_add", "job", job.id, { file_id: fileId, content_type: type, size: bytes.length });
  return json({ file: fileView(job.id, { id: fileId, kind: "photo", content_type: type, size: bytes.length, preview_key: previewKey, preview_size: preview?.length ?? null, filename, caption, uploaded_by: user.id, created_at: t }) }, 201);
}

/** What the dashboard gets for a photo or video: never the storage key, just the URLs. */
function fileView(jobId: string, f: { id: string; preview_key: string | null } & Record<string, unknown>) {
  const { preview_key, ...rest } = f;
  const url = `/api/jobs/${jobId}/files/${f.id}`;
  return { ...rest, url, thumb_url: preview_key ? `${url}?v=preview` : f.kind === "video" ? null : url };
}

/** Videos are streamed straight into storage (they're too big to hold in memory), then checked by their first bytes. */
async function uploadVideo(ctx: Ctx) {
  const { env, req } = ctx;
  const user = userOf(ctx);
  const job = await mustGetJob(ctx);
  const len = Number(req.headers.get("content-length") || 0);
  if (!len || !req.body) throw new HttpError(411, "length_required", "The video couldn't be read. Try again.");
  if (len > MAX_VIDEO_BYTES) throw new HttpError(413, "too_large", "Videos can be up to 95 MB. Trim it or record a shorter clip.");
  const declared = (req.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
  if (declared && !VIDEO_DECLARED.includes(declared)) throw new HttpError(415, "unsupported_type", "Only videos can be uploaded here (MP4, MOV or WebM).", { file: "Not a supported video." });
  let filename: string | null = null;
  try { filename = decodeURIComponent(req.headers.get("x-file-name") || "").trim().slice(0, 120) || null; } catch { filename = null; }

  const fileId = newId("jfl");
  const key = `jobs/${job.id}/${fileId}`;
  await env.FILES.put(key, req.body, { httpMetadata: { contentType: declared || "video/mp4" }, customMetadata: { job_id: job.id, uploaded_by: user.id } });
  const head = await env.FILES.get(key, { range: { offset: 0, length: 64 } });
  const type = head ? sniffVideo(new Uint8Array(await head.arrayBuffer())) : null;
  const stored = await env.FILES.head(key);
  if (!type || !stored) {
    await env.FILES.delete(key);
    throw new HttpError(415, "unsupported_type", "Only videos can be uploaded here (MP4, MOV or WebM).", { file: "Not a supported video." });
  }
  const t = now();
  await run(env, "INSERT INTO job_files (id, job_id, r2_key, kind, content_type, size, filename, uploaded_by, created_at) VALUES (?, ?, ?, 'video', ?, ?, ?, ?, ?)",
    fileId, job.id, key, type, stored.size, filename, user.id, t);
  await run(env, "UPDATE jobs SET updated_at = ? WHERE id = ?", t, job.id);
  await audit(env, user.id, "job.file_add", "job", job.id, { file_id: fileId, content_type: type, size: stored.size, kind: "video" });
  return json({ file: fileView(job.id, { id: fileId, kind: "video", content_type: type, size: stored.size, preview_key: null, preview_size: null, filename, caption: null, uploaded_by: user.id, created_at: t }) }, 201);
}

interface FileRow { id: string; job_id: string; r2_key: string; content_type: string; size: number; preview_key: string | null; kind: string }

async function mustGetFile(ctx: Ctx): Promise<FileRow> {
  const f = await first<FileRow>(ctx.env, "SELECT id, job_id, r2_key, kind, content_type, size, preview_key FROM job_files WHERE id = ? AND job_id = ?", ctx.params.fileId, ctx.params.id);
  if (!f) throw notFound("Photo");
  return f;
}

async function getFile(ctx: Ctx) {
  const f = await mustGetFile(ctx);
  if (ctx.url.searchParams.get("v") === "preview" && f.preview_key) return serveStored(ctx.env, ctx.req, f.preview_key, "image/jpeg");
  return serveStored(ctx.env, ctx.req, f.r2_key, f.content_type);
}

async function deleteFile(ctx: Ctx) {
  const f = await mustGetFile(ctx);
  await ctx.env.FILES.delete(f.preview_key ? [f.r2_key, f.preview_key] : f.r2_key);
  await run(ctx.env, "DELETE FROM job_files WHERE id = ?", f.id);
  await audit(ctx.env, userOf(ctx).id, "job.file_delete", "job", f.job_id, { file_id: f.id });
  return json({ ok: true });
}

// ---------- people ----------
async function listUsers(ctx: Ctx) {
  return json({ users: await all(ctx.env, "SELECT id, name FROM users ORDER BY name COLLATE NOCASE") });
}

const jobs: Module = {
  name: "jobs",
  register(r) {
    r.get("/api/users", listUsers);
    r.get("/api/jobs", listJobs);
    r.post("/api/jobs", createJob);
    r.post("/api/jobs/from-booking/:bookingId", createFromBooking);
    r.get("/api/jobs/:id", jobDetail);
    r.patch("/api/jobs/:id", updateJob);
    r.patch("/api/jobs/:id/vehicle", updateJobVehicle);
    r.post("/api/jobs/:id/notes", addNote);
    r.patch("/api/jobs/:id/notes/:noteId", editNote);
    r.delete("/api/jobs/:id/notes/:noteId", deleteNote);
    r.post("/api/jobs/:id/files", uploadFile);
    r.post("/api/jobs/:id/videos", uploadVideo);
    r.get("/api/jobs/:id/files/:fileId", getFile);
    r.delete("/api/jobs/:id/files/:fileId", deleteFile);
  },
};
export default jobs;
