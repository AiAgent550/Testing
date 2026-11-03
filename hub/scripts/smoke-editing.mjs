// End-to-end checks for correcting mistakes: editing jobs and bookings, fixing registrations
// (typo in place, relink to a known car, new car when the old one is shared, clearing) and editing notes.
import { execFileSync } from "node:child_process";
import { checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("editing");
const call = await signIn();
const me = (await call("/api/auth/me")).data?.user;
const stamp = String(Date.now()).slice(-5);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const vehicleOf = async jobId => (await call(`/api/jobs/${jobId}`)).data;
const bookingOf = async id => (await call(`/api/bookings/${id}`)).data;

// ---- set up: a booking with a typo'd plate, its job, and a second booking on another car ----
let r = await call("/api/bookings", { method: "POST", body: { name: "Edit Test One", phone: `07700 91${stamp}`, reg: "ED12TYP", service: "keys", description: "All keys lost" } });
const b1 = r.data?.booking;
check("booking with a typo'd plate is created", r.status === 201 && !!b1?.vehicle_id, r.data);
r = await call(`/api/jobs/from-booking/${b1.id}`, { method: "POST" });
const j1 = r.data?.job;
check("job opens from it with the plate in the title", r.status === 201 && j1?.title === "Keys and immobiliser · ED12 TYP", j1);
r = await call("/api/bookings", { method: "POST", body: { name: "Edit Test Two", phone: `07700 92${stamp}`, reg: "RL70ABC", service: "remap" } });
const b2 = r.data?.booking;
check("second booking on another car", r.status === 201 && !!b2?.vehicle_id, r.data);

// ---- 1. typo fixed in place (car only used by this job and its booking) ----
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "ed12 tyq" } });
let d = await vehicleOf(j1.id);
check("typo is corrected on the same car", r.status === 200 && r.data?.reg_change === "corrected" && d.vehicle?.id === b1.vehicle_id && d.vehicle?.reg === "ED12TYQ", { res: r.data, vehicle: d.vehicle });
check("title follows the corrected plate", d.job?.title === "Keys and immobiliser · ED12 TYQ", d.job?.title);
check("booking still points at the same car", (await bookingOf(b1.id)).vehicle?.reg === "ED12TYQ");

// ---- 2. a plate already in the Hub: relink ----
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "RL70ABC" } });
d = await vehicleOf(j1.id);
check("a known plate links the job to that car", r.data?.reg_change === "relinked" && d.vehicle?.id === b2.vehicle_id, { res: r.data, vehicle: d.vehicle });
check("the job's booking follows", (await bookingOf(b1.id)).booking?.vehicle_id === b2.vehicle_id);
check("the other booking's car is untouched", (await bookingOf(b2.id)).vehicle?.reg === "RL70ABC");

// ---- 3. car shared with another booking: a new car, the old one untouched ----
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "NW70NEW" } });
d = await vehicleOf(j1.id);
check("a shared car gets a new record instead of being renamed", r.data?.reg_change === "created" && d.vehicle?.reg === "NW70NEW" && d.vehicle?.id !== b2.vehicle_id, { res: r.data, vehicle: d.vehicle });
check("the shared car keeps its plate", (await bookingOf(b2.id)).vehicle?.reg === "RL70ABC");

// ---- 4. clearing the plate unlinks the car ----
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "" } });
d = await vehicleOf(j1.id);
check("an empty plate unlinks the car and drops it from the title", r.data?.reg_change === "cleared" && d.vehicle === null && d.job?.title === "Keys and immobiliser", { res: r.data, job: d.job });
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "!" } });
check("a nonsense plate is refused with a field error", r.status === 400 && !!r.data?.error?.fields?.reg, r.data);

// ---- 5. other job fields ----
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { title: "Spare key and remote", description: "Customer has one key left", mileage: 64120, assigned_to: me?.id } });
d = await vehicleOf(j1.id);
check("title, issue, mileage and assignee can be edited", r.status === 200 && d.job?.title === "Spare key and remote" && d.job?.description === "Customer has one key left" && d.job?.mileage === 64120 && d.job?.assigned_to === me?.id, d.job);
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { reg: "MX65VIN" } });
r = await call(`/api/jobs/${j1.id}/vehicle`, { method: "PATCH", body: { vin: "WDD2050042R123456" } });
check("a plate and VIN can be added back", r.status === 200 && r.data?.vehicle?.reg === "MX65VIN" && r.data?.vehicle?.vin === "WDD2050042R123456", r.data);
check("a typed title is left alone when the plate changes", (await vehicleOf(j1.id)).job?.title === "Spare key and remote");

// ---- 6. customer on a job ----
r = await call("/api/customers", { method: "POST", body: { name: "Edit Test Owner", phone: `07700 93${stamp}` } });
const c2 = r.data?.customer;
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { customer_id: c2?.id } });
check("the job moves to another customer", r.status === 200 && r.data?.job?.customer_id === c2?.id, r.data);
check("its booking moves with it", (await bookingOf(b1.id)).booking?.customer_id === c2?.id);
r = await call(`/api/jobs/${j1.id}`, { method: "PATCH", body: { customer_id: "cus_doesnotexist" } });
check("an unknown customer is refused", r.status === 400 && !!r.data?.error?.fields?.customer_id, r.data);

// ---- 7. editing a booking ----
r = await call(`/api/bookings/${b2.id}`, { method: "PATCH", body: { reg: "RL70ABD", service: "diagnostics", preferred_date: tomorrow, description: "Warning light" } });
let bd = await bookingOf(b2.id);
check("booking plate typo is corrected on its own car", r.status === 200 && r.data?.reg_change === "corrected" && bd.vehicle?.id === b2.vehicle_id && bd.vehicle?.reg === "RL70ABD", { res: r.data, vehicle: bd.vehicle });
check("booking service, date and description are saved", bd.booking?.service === "diagnostics" && bd.booking?.preferred_date === tomorrow && bd.booking?.description === "Warning light", bd.booking);
r = await call(`/api/bookings/${b2.id}`, { method: "PATCH", body: { customer_id: c2?.id } });
check("booking moves to another customer", r.status === 200 && (await bookingOf(b2.id)).customer?.id === c2?.id, r.data);
r = await call(`/api/bookings/${b1.id}`, { method: "PATCH", body: { reg: "BK70JOB" } });
d = await vehicleOf(j1.id);
check("changing a booking's plate moves its job too", r.status === 200 && d.vehicle?.reg === "BK70JOB" && (await bookingOf(b1.id)).vehicle?.reg === "BK70JOB", { res: r.data, vehicle: d.vehicle });
r = await call(`/api/customers/${c2?.id}`, { method: "PATCH", body: { name: "Edit Test Owner Fixed", phone: `07700 94${stamp}` } });
check("the customer's own details can be corrected", r.status === 200 && r.data?.customer?.name === "Edit Test Owner Fixed", r.data);

// ---- 8. notes: only the author can edit or delete ----
r = await call(`/api/jobs/${j1.id}/notes`, { method: "POST", body: { body: "ELV replaced, adpating EIS" } });
const note = r.data?.note;
r = await call(`/api/jobs/${j1.id}/notes/${note.id}`, { method: "PATCH", body: { body: "ELV replaced, adapting EIS" } });
check("the author can fix a note", r.status === 200 && r.data?.note?.body === "ELV replaced, adapting EIS" && !!r.data?.note?.edited_at, r.data);
d = await vehicleOf(j1.id);
check("the note shows as edited and as mine", d.notes?.[0]?.edited_at && d.notes?.[0]?.mine === true, d.notes);

const emailB = `editing-b${stamp}@mk.test`, passB = "smoke-test-password-456";
execFileSync("node", ["scripts/create-user.mjs", "--email", emailB, "--name", "Other Tech"], { env: { ...process.env, MK_PASSWORD: passB }, stdio: "ignore" });
const callB = await signIn(emailB, passB);
r = await callB(`/api/jobs/${j1.id}/notes/${note.id}`, { method: "PATCH", body: { body: "changed by someone else" } });
check("someone else can't edit the note", r.status === 403, r.data);
r = await callB(`/api/jobs/${j1.id}/notes/${note.id}`, { method: "DELETE" });
check("someone else can't delete the note", r.status === 403, r.data);
check("the other person doesn't see it as theirs", (await callB(`/api/jobs/${j1.id}`)).data?.notes?.[0]?.mine === false);
r = await call(`/api/jobs/${j1.id}/notes/${note.id}`, { method: "PATCH", body: { body: "x" }, headers: { origin: "https://evil.example" } });
check("note edits from another website are blocked", r.status === 403);
r = await call(`/api/jobs/${j1.id}/notes/${note.id}`, { method: "DELETE" });
check("the author can delete the note", r.status === 200 && (await vehicleOf(j1.id)).notes?.length === 0, r.data);
r = await call(`/api/jobs/${j1.id}/notes/jnt_nope`, { method: "DELETE" });
check("an unknown note is a 404", r.status === 404);

// ---- 9. editing is quiet: no push/inbox spam for the other person ----
const inboxB = (await callB("/api/notifications")).data;
const editSpam = (inboxB?.notifications || []).filter(n => /edit/i.test(n.kind || ""));
check("edits don't create notifications", editSpam.length === 0, inboxB);

done();
