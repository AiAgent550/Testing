// Module: jobs. Job cards for the workshop: status, assignee, mileage/VIN, notes and photos.
// Logic other modules may call lives in service.ts.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import type { JobRow, JobStatus } from "../../lib/types";
import { JOB_STATUSES } from "../../lib/types";
import { audit } from "../../lib/audit";
import { all, first, newId, nextRef, now, run, updateSet } from "../../lib/db";
import { HttpError, badRequest, json, notFound } from "../../lib/http";
import { int, nullable, oneOf, optional, parse, reg, str, vin } from "../../lib/validate";
import { setBookingStatus } from "../bookings/service";
import { ensureVehicle, updateVehicle } from "../vehicles/service";
import { latestSuggestion } from "../ai/service";
import { formatReg, getJob, openJobForBooking, readVehicle, soft } from "./service";
import { ACTIVE_STATUSES, canTransition, transitionStamps } from "./status";
import { ALLOWED_DECLARED, MAX_PHOTO_BYTES, sniffImage } from "./files";

const id = (prefix: string) => (v: unknown, f: string) => {
  const s = str({ max: 64 })(v, f);
  if (!s.startsWith(`${prefix}_`)) throw badRequest("Some fields need fixing.", { [f]: "Not a valid id." });
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
    all(env, "SELECT n.id, n.body, n.created_at, n.user_id, u.name AS author_name FROM job_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.job_id = ? ORDER BY n.created_at, n.id", job.id),
    all<{ id: string }>(env, "SELECT id, content_type, size, caption, uploaded_by, created_at FROM job_files WHERE job_id = ? ORDER BY created_at, id", job.id),
    latestSuggestion(env, job.id),
    job.assigned_to ? first<{ name: string }>(env, "SELECT name FROM users WHERE id = ?", job.assigned_to) : null,
  ]);
  const v = vehicle && {
    id: vehicle.id, reg: vehicle.reg, vin: vehicle.vin, make: vehicle.make, model: vehicle.model, colour: vehicle.colour,
    fuel_type: vehicle.fuel_type, year: vehicle.year, engine_cc: vehicle.engine_cc, last_mileage: vehicle.last_mileage,
    mot_status: vehicle.mot_status, mot_expiry: vehicle.mot_expiry,
  };
  return json({
    job: { ...job, assignee_name: assignee?.name ?? null },
    customer, vehicle: v, booking, notes,
    files: files.map(f => ({ ...f, url: `/api/jobs/${job.id}/files/${f.id}` })),
    suggestion,
  });
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
    `INSERT INTO jobs (id, ref, customer_id, vehicle_id, title, description, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    jobId, ref, input.customer_id ?? null, vehicleId, title, input.description ?? null, user.id, t, t);
  await audit(env, user.id, "job.create", "job", jobId, { ref, vehicle_id: vehicleId, customer_id: input.customer_id ?? null });
  return json({ job: await getJob(env, jobId) }, 201);
}

async function createFromBooking(ctx: Ctx) {
  const { job, created } = await openJobForBooking(ctx.env, ctx.params.bookingId, userOf(ctx).id);
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
  });
  const patch: Record<string, unknown> = { title: input.title, description: input.description, mileage: input.mileage };
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
  const { sql, params } = updateSet(patch, ["title", "description", "mileage", "assigned_to", "status", "started_at", "completed_at"]);
  if (!sql) return json({ job });
  await run(env, `UPDATE jobs SET ${sql}, updated_at = ? WHERE id = ?`, ...params, t, job.id);

  const changed = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await audit(env, user.id, moving ? "job.status" : "job.update", "job", job.id, { ...changed, ...(moving ? { from: job.status } : {}) });
  if (moving && input.status === "completed" && job.booking_id) {
    await soft("bookings.setBookingStatus(completed)", () => setBookingStatus(env, job.booking_id!, "completed", user.id));
  }
  return json({ job: await getJob(env, job.id) });
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
  return json({ note: { id: noteId, body, created_at: t, user_id: user.id, author_name: user.name } }, 201);
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
  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim().slice(0, 200) : null;

  const fileId = newId("jfl");
  const key = `jobs/${job.id}/${fileId}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { job_id: job.id, uploaded_by: user.id } });
  const t = now();
  await run(env, "INSERT INTO job_files (id, job_id, r2_key, content_type, size, caption, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    fileId, job.id, key, type, bytes.length, caption, user.id, t);
  await run(env, "UPDATE jobs SET updated_at = ? WHERE id = ?", t, job.id);
  await audit(env, user.id, "job.file_add", "job", job.id, { file_id: fileId, content_type: type, size: bytes.length });
  return json({ file: { id: fileId, content_type: type, size: bytes.length, caption, uploaded_by: user.id, created_at: t, url: `/api/jobs/${job.id}/files/${fileId}` } }, 201);
}

interface FileRow { id: string; job_id: string; r2_key: string; content_type: string; size: number }

async function mustGetFile(ctx: Ctx): Promise<FileRow> {
  const f = await first<FileRow>(ctx.env, "SELECT id, job_id, r2_key, content_type, size FROM job_files WHERE id = ? AND job_id = ?", ctx.params.fileId, ctx.params.id);
  if (!f) throw notFound("Photo");
  return f;
}

async function getFile(ctx: Ctx) {
  const f = await mustGetFile(ctx);
  const obj = await ctx.env.FILES.get(f.r2_key);
  if (!obj) throw notFound("Photo");
  return new Response(obj.body, {
    headers: {
      "content-type": f.content_type,
      "content-length": String(obj.size),
      "cache-control": "private, max-age=3600",
      "content-disposition": "inline",
    },
  });
}

async function deleteFile(ctx: Ctx) {
  const f = await mustGetFile(ctx);
  await ctx.env.FILES.delete(f.r2_key);
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
    r.post("/api/jobs/:id/files", uploadFile);
    r.get("/api/jobs/:id/files/:fileId", getFile);
    r.delete("/api/jobs/:id/files/:fileId", deleteFile);
  },
};
export default jobs;
