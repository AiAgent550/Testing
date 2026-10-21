// Bookings: requests from the website and the phone, confirming slots, and moving each booking on.
import {
  SERVICE_LABELS, api, chip, empty, field, fmtAgo, fmtDate, fmtDateTime, fmtPhone, h, icon, loading,
  pageHead, plate, segmented, sheet, showFieldErrors, toast,
} from "../core.js";

const STATUS_LABELS = {
  requested: "Request", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", no_show: "No-show",
};
// Mirrors TRANSITIONS in src/modules/bookings/status.ts (the server re-checks every move).
const MOVE_LABELS = {
  confirmed: "Back to confirmed", in_progress: "Car's in: start work", completed: "Mark completed",
  cancelled: "Cancel booking", no_show: "Didn't turn up", requested: "Back to requests",
};
const SOURCE_LABELS = { website: "Website", phone: "Phone", social: "Social media", walk_in: "Walk-in", other: "Other" };

let filter = "requests";
let query = "";

export async function render(view, ctx) {
  if (ctx.params[0]) return renderDetail(view, ctx.params[0], ctx);
  return renderList(view, ctx);
}

// ---------- helpers ----------
const pad = n => String(n).padStart(2, "0");
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => localDate(new Date());
const tomorrow = () => localDate(new Date(Date.now() + 864e5));
const normReg = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const serviceLabel = s => SERVICE_LABELS[s] || s;

function carName(v) {
  if (!v) return "";
  const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return [name, v.colour ? String(v.colour).toLowerCase() : null].filter(Boolean).join(", ");
}

function motLine(v) {
  const bits = [];
  if (v.mot_expiry) bits.push(`MOT ${v.mot_status && /not valid/i.test(v.mot_status) ? "expired" : "until"} ${fmtDate(v.mot_expiry)}`);
  else if (v.mot_status) bits.push(`MOT: ${v.mot_status}`);
  if (v.tax_status) bits.push(`Tax: ${v.tax_status.toLowerCase()}`);
  if (v.last_mileage) bits.push(`${Number(v.last_mileage).toLocaleString("en-GB")} miles`);
  return bits.join(" · ");
}

function when(b) {
  if (b.scheduled_start) return fmtDateTime(b.scheduled_start);
  if (b.preferred_date) return `Asked for ${fmtDate(b.preferred_date)}`;
  return `Received ${fmtAgo(b.created_at)}`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const statusChip = s => chip(s, STATUS_LABELS[s] || s);

function serviceSelect(value) {
  return h("select.input", { name: "service", required: true },
    Object.entries(SERVICE_LABELS).map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
}

/** Reg input that looks the car up as you type and shows what it found underneath. */
function regLookup(initial = "") {
  const input = h("input.input.reg", { name: "reg", value: initial, autocomplete: "off", autocapitalize: "characters", spellcheck: false, placeholder: "AB12 CDE", "aria-describedby": "reg-found" });
  const out = h("p.small.muted", { id: "reg-found", "aria-live": "polite", style: "margin:0;min-height:1.3em" });
  let last = "", seq = 0;
  async function run() {
    const reg = normReg(input.value);
    if (reg === last) return;
    last = reg;
    if (reg.length < 2) { out.textContent = ""; return; }
    const mine = ++seq;
    out.textContent = "Looking up the car…";
    try {
      const { lookup } = await api(`/api/vehicles/lookup/${encodeURIComponent(reg)}`);
      if (mine !== seq) return;
      out.replaceChildren();
      if (lookup.found) {
        const mot = motLine(lookup);
        out.append(h("strong", { style: "color:var(--chrome)" }, carName(lookup) || "Found"));
        if (mot) out.append(h("br"), mot);
      } else if (lookup.sources.dvla === "not_configured" && lookup.sources.dvsa === "not_configured") {
        out.textContent = "Car lookup isn't connected yet. Add the make and model to the description.";
      } else if (lookup.sources.dvla === "error" || lookup.sources.dvsa === "error") {
        out.textContent = "The lookup service didn't answer. You can still save the booking.";
      } else {
        out.textContent = "No record found for that registration. Check it, or save anyway.";
      }
    } catch (err) {
      if (mine === seq) out.textContent = err.fields?.reg || "Couldn't look that registration up.";
    }
  }
  const later = debounce(run, 600);
  input.addEventListener("input", () => { if (normReg(input.value).length >= 5) later(); });
  input.addEventListener("blur", run);
  if (initial) run();
  return { input, out };
}

// ---------- list ----------
async function renderList(view, { navigate, refreshCounts }) {
  const listBox = h("div");
  const search = h("input.input", { type: "search", placeholder: "Search name, phone, reg or reference", value: query, "aria-label": "Search bookings" });
  let seq = 0;

  async function load() {
    const mine = ++seq;
    const p = new URLSearchParams();
    if (filter === "requests") p.set("status", "requested");
    if (filter === "upcoming") { p.set("status", "confirmed,in_progress"); p.set("from", today()); }
    if (query) p.set("q", query);
    listBox.replaceChildren(loading());
    try {
      const { bookings } = await api(`/api/bookings?${p}`);
      if (mine !== seq) return;
      if (!bookings.length) {
        const text = query ? "Nothing matches that search." : filter === "requests" ? "No booking requests waiting. Nice." : filter === "upcoming" ? "Nothing booked in yet." : "No bookings yet.";
        listBox.replaceChildren(empty(text, "bookings"));
        return;
      }
      listBox.replaceChildren(h("div.list", bookings.map(b => h("a.row", { href: `#/bookings/${b.id}` },
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(b.reg), b.customer_name),
        statusChip(b.status),
        h("span.sub", [serviceLabel(b.service), when(b), b.location === "mobile" ? "Mobile" : null].filter(Boolean).join(" · ")),
      ))));
    } catch (err) {
      if (mine === seq) listBox.replaceChildren(empty(err.message, "bookings"));
    }
  }

  const seg = segmented([["requests", "Requests"], ["upcoming", "Upcoming"], ["all", "All"]], filter, v => { filter = v; load(); });
  search.addEventListener("input", debounce(() => { query = search.value.trim(); load(); }, 300));

  view.replaceChildren(
    pageHead("M&K Hub", "Bookings", h("button.btn.primary", { type: "button", onclick: () => newBooking(navigate, refreshCounts) }, icon("plus"), "New booking")),
    h("div.stack",
      h("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between" }, seg.el, h("div", { style: "flex:1 1 240px;max-width:420px" }, search)),
      listBox,
    ),
  );
  await load();
}

// ---------- new booking ----------
function newBooking(navigate, refreshCounts) {
  const { input: regInput, out: regOut } = regLookup();
  let location = "workshop", source = "phone";
  const address = field("Address for the visit", h("textarea.input", { name: "address", rows: 2 }));
  address.hidden = true;
  const form = h("form.form", { id: "new-booking", novalidate: true },
    field("Registration", regInput, "Leave blank if they don't know it yet."),
    regOut,
    h("div.form-row",
      field("Name", h("input.input", { name: "name", autocomplete: "off", required: true })),
      field("Phone", h("input.input", { name: "phone", type: "tel", inputmode: "tel", autocomplete: "off" })),
    ),
    field("Email (optional)", h("input.input", { name: "email", type: "email", autocomplete: "off" })),
    h("div.form-row",
      field("Service", serviceSelect("remap")),
      field("Preferred date", h("input.input", { name: "preferred_date", type: "date", min: today() })),
    ),
    field("What does it need?", h("textarea.input", { name: "description", rows: 3, maxlength: 2000 })),
    h("div.field", h("span", "Where"), segmented([["workshop", "At the workshop"], ["mobile", "Mobile visit"]], location, v => { location = v; address.hidden = v !== "mobile"; }).el),
    address,
    h("div.field", h("span", "How did they get in touch?"), segmented([["phone", "Phone"], ["walk_in", "Walk-in"], ["other", "Other"]], source, v => { source = v; }).el),
  );
  const save = h("button.btn.primary", { type: "submit", form: "new-booking" }, "Save booking");
  const close = sheet("New booking", form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    save.disabled = true;
    try {
      const body = { ...Object.fromEntries(new FormData(form)), location, source };
      if (location !== "mobile") delete body.address;
      const { booking } = await api("/api/bookings", { method: "POST", body });
      close();
      toast(`Booking ${booking.ref} saved.`);
      refreshCounts?.();
      navigate(`#/bookings/${booking.id}`);
    } catch (err) {
      showFieldErrors(form, err);
      toast(err.message, "bad");
    } finally { save.disabled = false; }
  });
}

// ---------- detail ----------
async function renderDetail(view, id, ctx) {
  const { navigate, refreshCounts } = ctx;
  const { booking: b, customer: c, vehicle: v, job, transitions } = await api(`/api/bookings/${encodeURIComponent(id)}`);
  const reload = () => { refreshCounts?.(); return renderDetail(view, id, ctx); };

  async function move(status) {
    try {
      await api(`/api/bookings/${b.id}/status`, { method: "POST", body: { status } });
      toast(`Booking marked ${STATUS_LABELS[status].toLowerCase()}.`);
      await reload();
    } catch (err) { toast(err.message, "bad"); }
  }

  // ---- customer ----
  const customerCard = h("section.card.stack",
    h("h2.h2", "Customer"),
    h("a", { href: `#/customers/${c.id}`, style: "font-weight:600;font-size:18px;text-decoration:none" }, c.name),
    h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
      c.phone ? h("a.btn.primary", { href: `tel:${c.phone}` }, icon("phone"), fmtPhone(c.phone)) : null,
      c.email ? h("a.btn", { href: `mailto:${c.email}` }, "Email") : null,
    ),
    c.email ? h("p.small.muted", { style: "margin:0" }, c.email) : null,
    !c.phone && !c.email ? h("p.muted", { style: "margin:0" }, "No contact details saved.") : null,
  );

  // ---- vehicle ----
  const vehicleCard = h("section.card.stack", h("h2.h2", "Vehicle"));
  if (v) {
    vehicleCard.append(
      h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" }, plate(v.reg), h("strong", carName(v) || "Details not looked up yet")),
      h("dl.kv",
        h("dt", "MOT"), h("dd", v.mot_expiry ? `${v.mot_status || ""} ${v.mot_status ? "· " : ""}expires ${fmtDate(v.mot_expiry)}` : v.mot_status || "Unknown"),
        h("dt", "Tax"), h("dd", v.tax_status ? `${v.tax_status}${v.tax_due ? ` · due ${fmtDate(v.tax_due)}` : ""}` : "Unknown"),
        h("dt", "Mileage"), h("dd", v.last_mileage ? `${Number(v.last_mileage).toLocaleString("en-GB")} miles` : "Unknown"),
        h("dt", "Engine"), h("dd", [v.engine_cc ? `${v.engine_cc} cc` : null, v.fuel_type].filter(Boolean).join(" · ") || "Unknown"),
        h("dt", "VIN"), h("dd.mono", v.vin || "Not recorded"),
      ),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
        h("button.btn.small", { type: "button", onclick: () => editVehicle(v, reload) }, "Edit VIN / mileage"),
        h("button.btn.small.ghost", { type: "button", onclick: async e => {
          e.currentTarget.disabled = true;
          try {
            const { lookup } = await api(`/api/vehicles/${v.id}/refresh`, { method: "POST" });
            toast(lookup?.found ? "Vehicle details refreshed." : "No new details: the lookup isn't connected or found nothing.");
            await reload();
          } catch (err) { toast(err.message, "bad"); e.currentTarget.disabled = false; }
        } }, "Refresh details"),
      ),
    );
  } else {
    vehicleCard.append(h("p.muted", { style: "margin:0" }, "No registration on this booking yet. Add one by editing the booking details or the job card."));
  }

  // ---- booking details ----
  const detailsCard = h("section.card.stack",
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px" }, h("h2.h2", "Booking"),
      h("button.btn.small", { type: "button", onclick: () => editBooking(b, reload) }, "Edit")),
    h("dl.kv",
      h("dt", "Service"), h("dd", serviceLabel(b.service)),
      h("dt", "Where"), h("dd", b.location === "mobile" ? `Mobile: ${b.address || "address not given"}` : "At the workshop"),
      h("dt", "Asked for"), h("dd", b.preferred_date ? fmtDate(b.preferred_date) : "Any time"),
      h("dt", "Booked for"), h("dd", b.scheduled_start ? `${fmtDateTime(b.scheduled_start)} to ${fmtDateTime(b.scheduled_end).split(", ").pop()}` : "Not confirmed yet"),
      h("dt", "Came from"), h("dd", SOURCE_LABELS[b.source] || b.source),
      h("dt", "Received"), h("dd", fmtDateTime(b.created_at)),
    ),
    h("div.stack", { style: "gap:6px" }, h("strong", "What they said"), h("p", { style: "margin:0;white-space:pre-wrap" }, b.description || "Nothing added.")),
  );

  // ---- next steps ----
  const actions = h("section.card.stack", h("h2.h2", "Next step"));
  if (b.status === "requested" || b.status === "confirmed") {
    const start = b.scheduled_start ? new Date(b.scheduled_start) : null;
    const confirmForm = h("form.form", { novalidate: true },
      h("div.form-row",
        field("Date", h("input.input", { name: "date", type: "date", required: true, value: start ? localDate(start) : (b.preferred_date && b.preferred_date >= today() ? b.preferred_date : tomorrow()) })),
        field("Time", h("input.input", { name: "time", type: "time", required: true, step: 900, value: start ? localTime(start) : "09:00" })),
        field("Until (optional)", h("input.input", { name: "end", type: "time", step: 900, value: b.scheduled_end ? localTime(new Date(b.scheduled_end)) : "" })),
      ),
      h("div", h("button.btn.primary", { type: "submit" }, b.status === "confirmed" ? "Reschedule" : "Confirm booking")),
    );
    confirmForm.addEventListener("submit", async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(confirmForm));
      if (!f.date || !f.time) { toast("Pick a date and a time.", "bad"); return; }
      const body = { scheduled_start: new Date(`${f.date}T${f.time}`).toISOString() };
      if (f.end) body.scheduled_end = new Date(`${f.date}T${f.end}`).toISOString();
      try {
        await api(`/api/bookings/${b.id}/confirm`, { method: "POST", body });
        toast(b.status === "confirmed" ? "Booking moved. The customer will be told." : "Booking confirmed. The customer will be told.");
        await reload();
      } catch (err) {
        showFieldErrors(confirmForm, { fields: { end: err.fields?.scheduled_end, date: err.fields?.scheduled_start } });
        toast(err.message, "bad");
      }
    });
    actions.append(confirmForm);
  }
  const moves = (transitions || []).filter(t => !(t === "confirmed" && b.status === "requested"));
  if (moves.length) {
    actions.append(h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, moves.map(t =>
      h("button.btn", { type: "button", class: t === "cancelled" || t === "no_show" ? "danger" : t === "in_progress" || t === "completed" ? "primary" : "", onclick: () => move(t) }, MOVE_LABELS[t] || t))));
  }
  if (!moves.length && !["requested", "confirmed"].includes(b.status)) actions.append(h("p.muted", { style: "margin:0" }, "This booking is closed."));

  const jobBtn = job
    ? h("a.btn", { href: `#/jobs/${job.id}` }, icon("jobs"), `Open job card ${job.ref}`)
    : ["requested", "confirmed", "in_progress"].includes(b.status)
      ? h("button.btn", { type: "button", onclick: async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api(`/api/jobs/from-booking/${b.id}`, { method: "POST" });
          const jobId = res.job?.id || res.id;
          if (!jobId) throw new Error("The job card didn't come back.");
          navigate(`#/jobs/${jobId}`);
        } catch (err) {
          toast(err.status === 404 || err.status === 405 ? "Job cards aren't switched on yet." : err.message, "bad");
          btn.disabled = false;
        }
      } }, icon("jobs"), "Open job card")
      : null;
  if (jobBtn) actions.append(h("div", jobBtn));

  // ---- internal notes ----
  const notes = h("textarea.input", { name: "internal_notes", rows: 4, maxlength: 4000, placeholder: "Only the two of you see these." }, b.internal_notes || "");
  const notesForm = h("form.form", field("Internal notes", notes), h("div", h("button.btn", { type: "submit" }, "Save notes")));
  notesForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", body: { internal_notes: notes.value } });
      showFieldErrors(notesForm, null);
      toast("Notes saved.");
    } catch (err) { showFieldErrors(notesForm, err); toast(err.message, "bad"); }
  });

  view.replaceChildren(
    h("div", { style: "margin-bottom:10px" }, h("a.btn.small.ghost", { href: "#/bookings" }, icon("back"), "Bookings")),
    pageHead(`${b.ref} · ${serviceLabel(b.service)}`, c.name, statusChip(b.status)),
    h("div.grid-2", actions, detailsCard, customerCard, vehicleCard, h("section.card", notesForm)),
  );
}

function editBooking(b, reload) {
  let location = b.location;
  const address = field("Address for the visit", h("textarea.input", { name: "address", rows: 2 }, b.address || ""));
  address.hidden = location !== "mobile";
  const form = h("form.form", { id: "edit-booking", novalidate: true },
    h("div.form-row",
      field("Service", serviceSelect(b.service)),
      field("Preferred date", h("input.input", { name: "preferred_date", type: "date", value: b.preferred_date || "" })),
    ),
    field("What does it need?", h("textarea.input", { name: "description", rows: 4, maxlength: 2000 }, b.description || "")),
    h("div.field", h("span", "Where"), segmented([["workshop", "At the workshop"], ["mobile", "Mobile visit"]], location, v => { location = v; address.hidden = v !== "mobile"; }).el),
    address,
  );
  const save = h("button.btn.primary", { type: "submit", form: "edit-booking" }, "Save");
  const close = sheet("Booking details", form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), location };
    if (location !== "mobile") body.address = "";
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", body });
      close();
      toast("Booking updated.");
      await reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); }
  });
}

function editVehicle(v, reload) {
  const form = h("form.form", { id: "edit-vehicle", novalidate: true },
    field("VIN", h("input.input.mono", { name: "vin", value: v.vin || "", maxlength: 17, autocapitalize: "characters", autocomplete: "off", spellcheck: false }), "17 characters, from the scan tool or the windscreen."),
    field("Mileage", h("input.input", { name: "last_mileage", inputmode: "numeric", value: v.last_mileage ?? "" })),
  );
  const save = h("button.btn.primary", { type: "submit", form: "edit-vehicle" }, "Save");
  const close = sheet(`Vehicle ${v.reg}`, form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const body = { vin: f.vin, last_mileage: f.last_mileage === "" ? null : String(f.last_mileage).replace(/[,\s]/g, "") };
    try {
      await api(`/api/vehicles/${v.id}`, { method: "PATCH", body });
      close();
      toast("Vehicle saved.");
      await reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); }
  });
}
