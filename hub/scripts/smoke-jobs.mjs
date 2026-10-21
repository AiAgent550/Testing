// End-to-end checks for jobs and AI tool suggestions against a running Hub.
// Uses the rows from test/fixtures/jobs-seed.sql; doesn't depend on the customers/vehicles/bookings endpoints.
import { deflateSync } from "node:zlib";
import { anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("jobs");
const call = await signIn();

const SEED = { booking: "bkg_jobseed0000000000001", booking2: "bkg_jobseed0000000000002", cancelled: "bkg_jobseed0000000000003", vehicle: "veh_jobseed0000000000001", customer: "cus_jobseed0000000000001" };
const KNOWN_TOOLS = ["Magic Motorsport Flex", "Transdata", "Ioprog", "VVDI Prog", "Launch X431 IMMO", "Abrites (Mercedes-Benz)", "Workshop diagnostics"];

// ---- a tiny valid PNG (1x1, RGB) built by hand ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 191, 227, 255]))), chunk("IEND", Buffer.alloc(0))]);
const photoForm = (bytes, type, name = "photo.png", caption) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  if (caption) fd.append("caption", caption);
  return fd;
};

// ---- access ----
let r = await anon("/api/jobs");
check("jobs API refuses anonymous requests", r.status === 401);

// ---- job from booking ----
r = await call(`/api/jobs/from-booking/${SEED.booking}`, { method: "POST" });
const job = r.data?.job;
check("job opens from a seeded booking", r.status === 201 && job?.booking_id === SEED.booking && /^J-\d+$/.test(job?.ref || ""), r.data);
check("job copies customer, vehicle and description", job?.customer_id === SEED.customer && job?.vehicle_id === SEED.vehicle && /All keys lost/.test(job?.description || ""), job);
check("job title is the service label and plate", job?.title === "Keys and immobiliser · MK26 JOB", job?.title);
r = await call(`/api/jobs/from-booking/${SEED.booking}`, { method: "POST" });
check("opening the same booking again returns the same job", r.status === 200 && r.data?.job?.id === job?.id && r.data?.created === false, r.data);
r = await call("/api/jobs/from-booking/bkg_doesnotexist", { method: "POST" });
check("unknown booking is a 404", r.status === 404);
r = await call(`/api/jobs/from-booking/${SEED.cancelled}`, { method: "POST" });
check("cancelled booking can't become a job", r.status === 409);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { title: "Hacked" }, headers: { origin: "https://evil.example" } });
check("changes from another website are blocked", r.status === 403);

// ---- list and detail ----
r = await call("/api/jobs?status=active");
const row = r.data?.jobs?.find(j => j.id === job.id);
check("active list includes the job with car and customer", r.status === 200 && row?.reg === "MK26JOB" && row?.make === "MERCEDES-BENZ" && row?.customer_name === "Jobs Seed Customer" && row?.customer_phone === "+447700900111", row);
r = await call("/api/jobs?status=bogus");
check("unknown status filter is rejected", r.status === 400);
r = await call(`/api/jobs/${job.id}`);
check("detail has customer, vehicle and booking", r.status === 200 && r.data?.customer?.phone === "+447700900111" && r.data?.vehicle?.model === "C 220 D" && r.data?.booking?.ref === "MK-J9001", r.data);
check("detail starts with no notes, photos or suggestion", r.data?.notes?.length === 0 && r.data?.files?.length === 0 && r.data?.suggestion === null);
r = await call("/api/jobs/job_nope");
check("unknown job is a 404", r.status === 404);

// ---- manual jobs ----
r = await call("/api/jobs", { method: "POST", body: { title: "Remap health check", description: "Customer wants more power", reg: "mk26 jbb" } });
check("manual job links an existing car by registration", r.status === 201 && r.data?.job?.vehicle_id === "veh_jobseed0000000000002", r.data);
r = await call("/api/jobs", { method: "POST", body: { title: "Walk-in diagnosis", reg: "ZZ99 ZZZ" } });
check("manual job keeps an unknown registration", r.status === 201 && (r.data?.job?.vehicle_id || r.data?.job?.title.includes("ZZ99 ZZZ")), r.data);
r = await call("/api/jobs", { method: "POST", body: { description: "no title" } });
check("manual job needs a title", r.status === 400 && !!r.data?.error?.fields?.title);
r = await call("/api/jobs", { method: "POST", body: { title: "x", customer_id: "cus_missing" } });
check("manual job rejects an unknown customer", r.status === 400 && !!r.data?.error?.fields?.customer_id);

// ---- status ----
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "completed" } });
check("open -> completed is refused", r.status === 409 && r.data?.error?.code === "invalid_transition", r.data);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "in_progress" } });
check("open -> in progress sets started_at", r.status === 200 && r.data?.job?.status === "in_progress" && !!r.data?.job?.started_at, r.data);
const startedAt = r.data?.job?.started_at;
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "waiting_parts" } });
check("in progress -> waiting for parts", r.status === 200 && r.data?.job?.status === "waiting_parts");
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "in_progress" } });
check("back to in progress keeps the first start time", r.status === 200 && r.data?.job?.started_at === startedAt);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "finished" } });
check("unknown status is rejected", r.status === 400);

// ---- notes ----
r = await call(`/api/jobs/${job.id}/notes`, { method: "POST", body: { body: "EIS reads fine. ELV clicks, no unlock." } });
check("note is added with its author", r.status === 201 && r.data?.note?.author_name === "Smoke jobs", r.data);
r = await call(`/api/jobs/${job.id}/notes`, { method: "POST", body: { body: "   " } });
check("empty note is rejected", r.status === 400);

// ---- photos ----
r = await call(`/api/jobs/${job.id}/files`, { method: "POST", body: photoForm(PNG, "image/png", "photo.png", "ELV connector") });
const file = r.data?.file;
check("photo uploads", r.status === 201 && file?.content_type === "image/png" && file?.size === PNG.length && file?.caption === "ELV connector", r.data);
r = await call(`/api/jobs/${job.id}/files/${file?.id}`);
const got = r.res.ok ? Buffer.from(await r.res.arrayBuffer()) : null;
check("photo comes back byte for byte", r.status === 200 && got?.equals(PNG), r.status);
check("photo is served privately, inline, with its type", r.res.headers.get("content-type") === "image/png" && r.res.headers.get("cache-control") === "private, max-age=3600" && (r.res.headers.get("content-disposition") || "").startsWith("inline"));
r = await anon(`/api/jobs/${job.id}/files/${file?.id}`);
check("photo isn't public", r.status === 401);
r = await call(`/api/jobs/${job.id}/files`, { method: "POST", body: photoForm(Buffer.from("just some text, not a picture at all"), "image/png", "fake.png") });
check("a non-image named .png is rejected by its bytes", r.status === 415, r.data);
r = await call(`/api/jobs/${job.id}/files`, { method: "POST", body: photoForm(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"), "application/pdf", "doc.pdf") });
check("a PDF is rejected", r.status === 415);
r = await call(`/api/jobs/${job.id}/files`, { method: "POST", body: { file: "nope" } });
check("JSON instead of a form upload is rejected", r.status === 400);
r = await call(`/api/jobs/${job.id}/files`, { method: "POST", body: photoForm(PNG, "image/png", "second.png") });
const second = r.data?.file;
r = await call(`/api/jobs/job_other/files/${file?.id}`);
check("photo is only served under its own job", r.status === 404);
r = await call(`/api/jobs/${job.id}/files/${second?.id}`, { method: "DELETE" });
check("photo deletes", r.status === 200);
r = await call(`/api/jobs/${job.id}/files/${second?.id}`);
check("deleted photo is gone", r.status === 404);

// ---- assignee, mileage, VIN ----
const me = (await call("/api/auth/me")).data?.user;
r = await call("/api/users");
check("users list for the assignee picker has id and name only", r.status === 200 && r.data?.users?.some(u => u.id === me?.id && u.name === "Smoke jobs") && r.data.users.every(u => Object.keys(u).sort().join() === "id,name"), r.data);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { assigned_to: me?.id } });
check("job is assigned", r.status === 200 && r.data?.job?.assigned_to === me?.id);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { assigned_to: "usr_nobody" } });
check("assigning to someone who doesn't exist is rejected", r.status === 400 && !!r.data?.error?.fields?.assigned_to);
r = await call("/api/jobs?mine=1");
check("'mine' lists jobs assigned to me", r.status === 200 && r.data?.jobs?.some(j => j.id === job.id && j.assignee_name === "Smoke jobs"));
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { mileage: 98123 } });
check("mileage saves on the job", r.status === 200 && r.data?.job?.mileage === 98123);
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { mileage: 1000000 } });
check("silly mileage is rejected", r.status === 400);
r = await call(`/api/jobs/${job.id}/vehicle`, { method: "PATCH", body: { vin: "wdd2050042f123456", mileage: 98200 } });
check("VIN and mileage from the car save (job mileage always)", r.status === 200 && r.data?.job?.mileage === 98200 && typeof r.data?.vehicle_updated === "boolean", r.data);
r = await call(`/api/jobs/${job.id}/vehicle`, { method: "PATCH", body: { vin: "WDD2050042F12345O" } });
check("invalid VIN is rejected", r.status === 400 && !!r.data?.error?.fields?.vin);

// ---- AI suggestions ----
r = await call("/api/ai/status");
const aiOn = r.data?.available === true;
check("AI status reports availability", r.status === 200 && typeof r.data?.available === "boolean");
r = await call(`/api/ai/jobs/${job.id}/suggest`, { method: "POST" });
const sug = r.data?.suggestion;
check("suggestion is returned", r.status === 200 && !!sug?.id && typeof sug?.summary === "string" && Array.isArray(sug?.steps), r.data);
check(aiOn ? "suggestion comes from AI or rules" : "without a key the suggestion comes from the rules", aiOn ? ["ai", "rules"].includes(r.data?.source) : r.data?.source === "rules" && sug?.model === "rules", r.data?.source);
check("every recommended tool is one the workshop has", sug?.recommended_tools?.length > 0 && sug.recommended_tools.every(t => KNOWN_TOOLS.includes(t.tool)), sug?.recommended_tools);
check("Mercedes all-keys-lost suggests Abrites", sug?.recommended_tools?.some(t => t.tool === "Abrites (Mercedes-Benz)"));
check("suggestion always reminds to back up first", JSON.stringify(sug).toLowerCase().includes("back up") || JSON.stringify(sug).toLowerCase().includes("backup"));
r = await call(`/api/ai/suggestions/${sug?.id}/feedback`, { method: "POST", body: { feedback: "helpful" } });
check("feedback is saved", r.status === 200 && r.data?.suggestion?.feedback === "helpful");
r = await call(`/api/ai/suggestions/${sug?.id}/feedback`, { method: "POST", body: { feedback: "meh" } });
check("unknown feedback is rejected", r.status === 400);
r = await call("/api/ai/jobs/job_nope/suggest", { method: "POST" });
check("suggesting for an unknown job is a 404", r.status === 404);
r = await call(`/api/jobs/${job.id}`);
check("detail shows notes, photo and the latest suggestion with feedback", r.data?.notes?.length === 1 && r.data?.files?.length === 1 && r.data?.suggestion?.id === sug?.id && r.data?.suggestion?.feedback === "helpful" && r.data?.job?.assignee_name === "Smoke jobs", r.data);

// ---- completion ----
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "completed" } });
check("completing sets completed_at", r.status === 200 && r.data?.job?.status === "completed" && !!r.data?.job?.completed_at, r.data);
r = await call("/api/jobs?status=completed");
check("completed list includes the job", r.data?.jobs?.some(j => j.id === job.id));
r = await call(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "in_progress" } });
check("completed job can be reopened, clearing completed_at", r.status === 200 && r.data?.job?.completed_at === null);

// ---- audit ----
r = await call(`/api/system/audit?entity=job&entity_id=${job.id}&limit=100`);
const actions = new Set((r.data?.entries || []).map(e => e.action));
check("job changes are audited", ["job.create_from_booking", "job.status", "job.update", "job.note_add", "job.file_add", "job.file_delete", "job.vehicle_details", "ai.suggest"].every(a => actions.has(a)), [...actions]);

done();
