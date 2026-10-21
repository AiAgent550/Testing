// The whole journey across every module, as the garage would live it:
// a social comment becomes a lead -> booked in -> confirmed -> job card -> AI suggestion
// -> VIN and mileage captured -> job completed -> booking completed; plus a website booking.
import { SITE_ORIGIN, anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("flow");
const call = await signIn();

// 1. Comments become leads (demo account, local only)
let r = await call("/api/social/accounts/mock", { method: "POST" });
check("demo social account connected", r.status === 200 || r.status === 201, r.data);
r = await call("/api/social/poll", { method: "POST" });
check("comment watcher runs", r.status === 200, r.data);
r = await call("/api/leads?status=new");
const lead = r.data?.leads?.find(l => l.service === "keys") ?? r.data?.leads?.[0];
check("a key-programming enquiry was picked out as a lead", !!lead, r.data);

// 2. Lead -> booking (bookings module, real implementation)
r = await call(`/api/leads/${lead.id}/book`, { method: "POST", body: { name: "Dan Smith", phone: "07700 900456", reg: "WR70 XYZ", service: "keys", description: "Lost both keys" } });
check("lead booked in", r.status === 201 && !!r.data?.booking?.id, r.data);
const bookingId = r.data.booking.id;
check("lead marked booked and linked", r.data?.lead?.status === "booked" && r.data?.lead?.booking_id === bookingId, r.data?.lead);

r = await call(`/api/bookings/${bookingId}`);
check("booking came from social and links the lead", r.data?.booking?.source === "social" && r.data?.booking?.lead_id === lead.id, r.data?.booking);
check("customer created with a UK phone number", r.data?.customer?.phone === "+447700900456", r.data?.customer);
check("car details filled from the registration", r.data?.vehicle?.reg === "WR70XYZ" && /Volkswagen/i.test(r.data?.vehicle?.make || ""), r.data?.vehicle);
const vehicleId = r.data?.vehicle?.id;

// 3. Confirm a slot
const start = new Date(Date.now() + 864e5); start.setUTCHours(9, 0, 0, 0);
r = await call(`/api/bookings/${bookingId}/confirm`, { method: "POST", body: { scheduled_start: start.toISOString() } });
check("booking confirmed with a time", r.status === 200 && r.data?.booking?.status === "confirmed" && !!r.data?.booking?.scheduled_end, r.data);

// 4. Job card from the booking
r = await call(`/api/jobs/from-booking/${bookingId}`, { method: "POST" });
check("job card opened from the booking", r.status === 201 && !!r.data?.job?.id, r.data);
const jobId = r.data.job.id;
r = await call(`/api/bookings/${bookingId}`);
check("booking moved to in progress", r.data?.booking?.status === "in_progress", r.data?.booking?.status);

// 5. AI (rules locally) suggestion uses the real kit
r = await call(`/api/ai/jobs/${jobId}/suggest`, { method: "POST" });
const tools = r.data?.suggestion?.recommended_tools ?? [];
check("tool suggestion returned", r.status === 200 && tools.length > 0, r.data);
check("suggestion mentions backing up first", JSON.stringify(r.data?.suggestion ?? {}).toLowerCase().includes("back"), r.data?.suggestion);

// 6. VIN and mileage at the car
r = await call(`/api/jobs/${jobId}/vehicle`, { method: "PATCH", body: { vin: "WVWZZZAUZLW123456", mileage: 48210 } });
check("VIN and mileage saved through the vehicles module", r.status === 200 && r.data?.vehicle_updated === true, r.data);
r = await call(`/api/vehicles/${vehicleId}`);
check("vehicle record now has the VIN", r.data?.vehicle?.vin === "WVWZZZAUZLW123456", r.data?.vehicle);

// 7. Work through to completion
r = await call(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: "in_progress" } });
check("job started", r.status === 200 && r.data?.job?.status === "in_progress", r.data);
r = await call(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: "completed" } });
check("job completed", r.status === 200 && r.data?.job?.status === "completed" && !!r.data?.job?.completed_at, r.data);
r = await call(`/api/bookings/${bookingId}`);
check("booking completed with the job", r.data?.booking?.status === "completed", r.data?.booking?.status);

// 8. A booking from the website lands in requests
r = await anon("/api/public/bookings", { method: "POST", headers: { origin: SITE_ORIGIN }, body: { name: "Web Customer", phone: "07700 900789", reg: "MK20AMG", service: "coding", description: "CarPlay retrofit coding", location: "workshop", website: "" } });
check("website booking accepted", r.status === 201 || r.status === 200, r.data);
r = await call("/api/bookings?status=requested");
check("website booking waiting in requests", r.data?.bookings?.some(b => b.customer_name === "Web Customer" || b.name === "Web Customer"), r.data?.bookings?.[0]);

// 9. Everything recorded
r = await call("/api/system/audit?limit=200");
const actions = new Set((r.data?.entries ?? []).map(e => e.action.split(".")[0]));
check("audit trail covers leads, bookings and jobs", ["lead", "booking", "job"].every(a => [...actions].some(x => x.startsWith(a))), [...actions]);
r = await call("/api/system/overview");
check("dashboard counts respond", r.status === 200 && r.data?.counts?.requested >= 1, r.data);

done();
