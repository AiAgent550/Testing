// End-to-end checks for customers, vehicles and bookings, including the website's public endpoints.
// Run by scripts/verify.sh against a fresh local Hub (no DVLA/DVSA keys, so the development fixtures answer).
import { SITE_ORIGIN, anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("bookings");
const call = await signIn();
const site = { origin: SITE_ORIGIN };
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
const stamp = String(Date.now()).slice(-6);
const phone = `07700 9${stamp.slice(0, 5)}`;

// ---------- public booking form ----------
let r = await anon("/api/public/bookings", { method: "OPTIONS", headers: { ...site, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
check("preflight from the website is allowed", r.status === 204 && r.res.headers.get("access-control-allow-origin") === SITE_ORIGIN && /content-type/i.test(r.res.headers.get("access-control-allow-headers") || ""));
r = await anon("/api/public/bookings", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
check("preflight from another site is refused", r.status === 403 && !r.res.headers.get("access-control-allow-origin"));

const booking = {
  name: "Smoke Customer", phone, email: `smoke${stamp}@example.com`, reg: "wr70 xyz", service: "remap",
  description: "Stage 1 please", preferred_date: tomorrow, location: "workshop", website: "",
};
r = await anon("/api/public/bookings", { method: "POST", body: booking, headers: site });
const ref = r.data?.ref;
check("website booking is accepted and returns a reference", r.status === 200 && /^MK-\d+$/.test(ref || ""), r.data);
check("website booking answer carries the CORS header", r.res.headers.get("access-control-allow-origin") === SITE_ORIGIN && /Origin/.test(r.res.headers.get("vary") || ""));

r = await anon("/api/public/bookings", { method: "POST", body: booking, headers: { origin: "https://evil.example" } });
check("booking from another origin is rejected", r.status === 403 && !r.res.headers.get("access-control-allow-origin"));
r = await anon("/api/public/bookings", { method: "POST", body: booking });
check("booking without an origin is rejected", r.status === 403);

r = await anon("/api/public/bookings", { method: "POST", body: { ...booking, name: `Honeypot ${stamp}`, phone: "07700 900001", website: "http://spam.example" }, headers: site });
check("honeypot gets a convincing answer", r.status === 200 && /^MK-\d+$/.test(r.data?.ref || ""));
const hpRef = r.data?.ref;

r = await anon("/api/public/bookings", { method: "POST", body: { ...booking, phone: "" }, headers: site });
check("missing phone gives a field error (readable by the website)", r.status === 400 && !!r.data?.error?.fields?.phone && r.res.headers.get("access-control-allow-origin") === SITE_ORIGIN, r.data);
r = await anon("/api/public/bookings", { method: "POST", body: { ...booking, preferred_date: yesterday, location: "mobile", address: "" }, headers: site });
check("past date and mobile without address are rejected", r.status === 400 && !!r.data?.error?.fields?.preferred_date && !!r.data?.error?.fields?.address, r.data);
r = await anon("/api/public/bookings", { method: "POST", body: { ...booking, description: "x".repeat(1001) }, headers: site });
check("description over 1000 characters is rejected", r.status === 400 && !!r.data?.error?.fields?.description);

// ---------- staff view ----------
r = await call("/api/bookings?status=requested");
const listed = r.data?.bookings?.find(b => b.ref === ref);
check("staff list shows the website request with customer and car", r.status === 200 && !!listed && listed.customer_name === "Smoke Customer" && listed.reg === "WR70XYZ" && listed.make === "Volkswagen", listed);
check("honeypot booking stored nothing", !r.data?.bookings?.some(b => b.ref === hpRef && b.customer_name?.startsWith("Honeypot")));
r = await call(`/api/customers?q=${encodeURIComponent(`Honeypot ${stamp}`)}`);
check("honeypot customer stored nothing", r.status === 200 && r.data.customers.length === 0);

const id = listed?.id;
r = await call(`/api/bookings/${id}`);
check("booking detail includes customer, vehicle and allowed moves", r.status === 200 && r.data.customer?.phone?.startsWith("+447700") && r.data.vehicle?.model === "Golf" && r.data.transitions?.includes("confirmed"), r.data);
check("website booking is recorded with source website", r.data?.booking?.source === "website" && r.data?.booking?.status === "requested");
const customerId = r.data?.customer?.id, vehicleId = r.data?.vehicle?.id;
check("vehicle is linked to the customer", r.data?.vehicle?.customer_id === customerId);

r = await call(`/api/bookings/${id}/status`, { method: "POST", body: { status: "completed" } });
check("invalid transition is rejected (requested -> completed)", r.status === 409, r.data);

const start = new Date(Date.now() + 2 * 864e5);
start.setUTCHours(9, 0, 0, 0);
r = await call(`/api/bookings/${id}/confirm`, { method: "POST", body: { scheduled_start: start.toISOString() } });
const confirmed = r.data?.booking;
check("confirm sets status and scheduled times (default slot length)", r.status === 200 && confirmed?.status === "confirmed"
  && confirmed?.scheduled_start === start.toISOString()
  && Date.parse(confirmed?.scheduled_end) - Date.parse(confirmed?.scheduled_start) === 120 * 60_000, r.data);
r = await call(`/api/bookings/${id}/status`, { method: "POST", body: { status: "completed" } });
check("invalid transition is rejected (confirmed -> completed)", r.status === 409);
r = await call(`/api/bookings/${id}/status`, { method: "POST", body: { status: "in_progress" } });
check("valid transition is accepted (confirmed -> in progress)", r.status === 200 && r.data?.booking?.status === "in_progress");
r = await call(`/api/bookings/${id}`, { method: "PATCH", body: { internal_notes: "Customer wants a dyno sheet", service: "remap" } });
check("internal notes save", r.status === 200 && r.data?.booking?.internal_notes === "Customer wants a dyno sheet");
r = await call(`/api/system/audit?limit=50`);
check("booking changes are audited", ["booking.create", "booking.confirm", "booking.status", "booking.update"].every(a => r.data?.entries?.some(e => e.action === a)));

r = await call("/api/notifications/outbox");
const msgs = (r.data?.messages || []).filter(m => m.entity_id === id);
check("outbox has a queued 'received' message for the booking", msgs.some(m => m.template === "booking.received" && m.status === "queued" && m.channel === "email"), msgs);
check("outbox has a queued 'confirmed' message", msgs.some(m => m.template === "booking.confirmed" && JSON.parse(m.payload_json).ref === ref));

// ---------- returning customer ----------
const digits = phone.replace(/\s/g, "");
r = await anon("/api/public/bookings", { method: "POST", body: { name: "Smoke C.", phone: "+44 " + digits.slice(1), service: "keys", location: "mobile", address: "1 Test Street, Leeds" }, headers: site });
check("second booking (phone typed differently) is accepted", r.status === 200, r.data);
const ref2 = r.data?.ref;
r = await call(`/api/bookings?q=${encodeURIComponent(ref2 || "none")}`);
const second = r.data?.bookings?.[0];
check("same phone reuses the customer", !!second && second.customer_id === customerId, second);
r = await call(`/api/customers/${customerId}`);
check("customer detail lists vehicles and both bookings", r.status === 200 && r.data.vehicles.some(v => v.reg === "WR70XYZ") && r.data.bookings.length >= 2);
r = await call("/api/customers?q=wr70");
check("customer search finds by registration", r.data?.customers?.some(c => c.id === customerId));
r = await call(`/api/customers?q=${encodeURIComponent(phone)}`);
check("customer search finds by phone as typed", r.data?.customers?.some(c => c.id === customerId));

// ---------- staff-entered booking ----------
r = await call("/api/bookings", { method: "POST", body: { name: "Walk In", phone: "07700 900777", reg: "BM19EEE", service: "diagnostics", source: "walk_in" } });
check("staff can enter a walk-in booking", r.status === 201 && r.data?.booking?.source === "walk_in" && !!r.data?.booking?.vehicle_id, r.data);
r = await call("/api/bookings", { method: "POST", body: { name: "Bad", service: "nope", location: "mobile" } });
check("staff booking validates fields", r.status === 400 && !!r.data?.error?.fields?.service);
r = await call(`/api/bookings/${r.data?.booking?.id || "x"}/status`, { method: "POST", body: { status: "confirmed" } });
check("unknown booking is a 404", r.status === 404);

// ---------- vehicles ----------
r = await call("/api/vehicles/lookup/mk20amg");
check("fixture registration looks up make and model", r.status === 200 && r.data.lookup.found && r.data.lookup.make === "Mercedes-Benz" && r.data.lookup.model === "AMG GT" && r.data.lookup.year === 2020, r.data);
r = await call("/api/vehicles/lookup/ZZ99ZZZ");
check("unknown registration is reported, not an error", r.status === 200 && r.data.lookup.found === false);
r = await call("/api/vehicles/lookup/!");
check("invalid registration gives a field error", r.status === 400 && !!r.data?.error?.fields?.reg);

r = await anon("/api/public/vehicle/MK20AMG", { headers: site });
check("public vehicle lookup returns only safe fields", r.status === 200 && JSON.stringify(Object.keys(r.data).sort()) === JSON.stringify(["colour", "found", "make", "model", "year"]) && r.data.make === "Mercedes-Benz" && r.res.headers.get("access-control-allow-origin") === SITE_ORIGIN, r.data);
r = await anon("/api/public/vehicle/MK20AMG", { headers: { origin: "https://evil.example" } });
check("public vehicle lookup refuses other origins", r.status === 403);

r = await call(`/api/vehicles/${vehicleId}`, { method: "PATCH", body: { vin: "WVWZZZ1KZOW000000" } });
check("vehicle PATCH rejects an invalid VIN", r.status === 400 && !!r.data?.error?.fields?.vin, r.data);
r = await call(`/api/vehicles/${vehicleId}`, { method: "PATCH", body: { vin: "wvwzzz1kzlw123456", last_mileage: 61500 } });
check("vehicle PATCH saves VIN and mileage", r.status === 200 && r.data?.vehicle?.vin === "WVWZZZ1KZLW123456" && r.data?.vehicle?.last_mileage === 61500, r.data);
r = await call(`/api/vehicles/${vehicleId}`);
check("vehicle detail has owner, bookings, jobs and MOT history", r.status === 200 && r.data.customer?.id === customerId && r.data.bookings.length >= 1 && Array.isArray(r.data.jobs) && r.data.vehicle.mot_tests.length > 0 && !("dvla_json" in r.data.vehicle), r.data);
r = await call(`/api/vehicles/${vehicleId}/refresh`, { method: "POST" });
check("vehicle refresh keeps the higher mileage", r.status === 200 && r.data?.vehicle?.last_mileage === 61500, r.data);

// ---------- rate limit (last: it blocks this IP for an hour) ----------
let limited = false;
for (let i = 0; i < 6 && !limited; i++) {
  r = await anon("/api/public/bookings", { method: "POST", body: { name: "Rate Test", phone: "07700 900888", service: "other" }, headers: site });
  limited = r.status === 429;
}
check("public bookings are rate limited per IP", limited && r.res.headers.get("access-control-allow-origin") === SITE_ORIGIN);

done();
