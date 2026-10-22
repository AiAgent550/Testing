// Bookings: requests from the website and the phone, confirming slots, and moving each booking on.
import {
  SERVICE_LABELS, api, chip, empty, field, fmtAgo, fmtDate, fmtDateTime, fmtMiles, fmtPhone, h, icon, loading,
  pageHead, plate, segmented, sheet, showFieldErrors, t, toast, translatable,
} from "../core.js";

const STATUS_LABELS = {
  requested: t("Request"), confirmed: t("Confirmed"), in_progress: t("In progress"), completed: t("Completed"), cancelled: t("Cancelled"), no_show: t("No-show"),
};
// What a toast says after a move ("Booking marked confirmed.").
const MOVED = {
  requested: t("Booking moved back to requests."), confirmed: t("Booking marked confirmed."), in_progress: t("Booking marked in progress."),
  completed: t("Booking marked completed."), cancelled: t("Booking cancelled."), no_show: t("Booking marked as a no-show."),
};
// Mirrors TRANSITIONS in src/modules/bookings/status.ts (the server re-checks every move).
const MOVE_LABELS = {
  confirmed: t("Back to confirmed"), in_progress: t("Car's in: start work"), completed: t("Mark completed"),
  cancelled: t("Cancel booking"), no_show: t("Didn't turn up"), requested: t("Back to requests"),
};
const SOURCE_LABELS = { website: t("Website"), phone: t("Phone"), social: t("Social media"), walk_in: t("Walk-in"), other: t("Other") };

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
  if (v.mot_expiry) bits.push(v.mot_status && /not valid/i.test(v.mot_status) ? t("MOT expired {date}", { date: fmtDate(v.mot_expiry) }) : t("MOT until {date}", { date: fmtDate(v.mot_expiry) }));
  else if (v.mot_status) bits.push(t("MOT: {status}", { status: v.mot_status }));
  if (v.tax_status) bits.push(t("Tax: {status}", { status: v.tax_status.toLowerCase() }));
  if (v.last_mileage) bits.push(fmtMiles(v.last_mileage));
  return bits.join(" · ");
}

function when(b) {
  if (b.scheduled_start) return fmtDateTime(b.scheduled_start);
  if (b.preferred_date) return t("Asked for {date}", { date: fmtDate(b.preferred_date) });
  return t("Received {when}", { when: fmtAgo(b.created_at) });
}

function debounce(fn, ms) {
  let tm;
  return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); };
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
    out.textContent = t("Looking up the car…");
    try {
      const { lookup } = await api(`/api/vehicles/lookup/${encodeURIComponent(reg)}`);
      if (mine !== seq) return;
      out.replaceChildren();
      if (lookup.found) {
        const mot = motLine(lookup);
        out.append(h("strong", { style: "color:var(--chrome)" }, carName(lookup) || t("Found")));
        if (mot) out.append(h("br"), mot);
      } else if (lookup.sources.dvla === "not_configured" && lookup.sources.dvsa === "not_configured") {
        out.textContent = t("Car lookup isn't connected yet. Add the make and model to the description.");
      } else if (lookup.sources.dvla === "error" || lookup.sources.dvsa === "error") {
        out.textContent = t("The lookup service didn't answer. You can still save the booking.");
      } else {
        out.textContent = t("No record found for that registration. Check it, or save anyway.");
      }
    } catch (err) {
      if (mine === seq) out.textContent = err.fields?.reg || t("Couldn't look that registration up.");
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
  const search = h("input.input", { type: "search", placeholder: t("Search name, phone, reg or reference"), value: query, "aria-label": t("Search bookings") });
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
        const text = query ? t("Nothing matches that search.") : filter === "requests" ? t("No booking requests waiting. Nice.") : filter === "upcoming" ? t("Nothing booked in yet.") : t("No bookings yet.");
        listBox.replaceChildren(empty(text, "bookings"));
        return;
      }
      listBox.replaceChildren(h("div.list", bookings.map(b => h("a.row", { href: `#/bookings/${b.id}` },
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(b.reg), b.customer_name),
        statusChip(b.status),
        h("span.sub", [serviceLabel(b.service), when(b), b.location === "mobile" ? t("Mobile") : null].filter(Boolean).join(" · ")),
      ))));
    } catch (err) {
      if (mine === seq) listBox.replaceChildren(empty(err.message, "bookings"));
    }
  }

  const seg = segmented([["requests", t("Requests")], ["upcoming", t("Upcoming")], ["all", t("All")]], filter, v => { filter = v; load(); });
  search.addEventListener("input", debounce(() => { query = search.value.trim(); load(); }, 300));

  view.replaceChildren(
    pageHead("Curve Hub", t("Bookings"), h("button.btn.primary", { type: "button", onclick: () => newBooking(navigate, refreshCounts) }, icon("plus"), t("New booking"))),
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
  const address = field(t("Address for the visit"), h("textarea.input", { name: "address", rows: 2 }));
  address.hidden = true;
  const form = h("form.form", { id: "new-booking", novalidate: true },
    field(t("Registration"), regInput, t("Leave blank if they don't know it yet.")),
    regOut,
    h("div.form-row",
      field(t("Name"), h("input.input", { name: "name", autocomplete: "off", required: true })),
      field(t("Phone"), h("input.input", { name: "phone", type: "tel", inputmode: "tel", autocomplete: "off" })),
    ),
    field(t("Email (optional)"), h("input.input", { name: "email", type: "email", autocomplete: "off" })),
    h("div.form-row",
      field(t("Service"), serviceSelect("remap")),
      field(t("Preferred date"), h("input.input", { name: "preferred_date", type: "date", min: today() })),
    ),
    field(t("What does it need?"), h("textarea.input", { name: "description", rows: 3, maxlength: 2000 })),
    h("div.field", h("span", t("Where")), segmented([["workshop", t("At the workshop")], ["mobile", t("Mobile visit")]], location, v => { location = v; address.hidden = v !== "mobile"; }).el),
    address,
    h("div.field", h("span", t("How did they get in touch?")), segmented([["phone", t("Phone")], ["walk_in", t("Walk-in")], ["other", t("Other")]], source, v => { source = v; }).el),
  );
  const save = h("button.btn.primary", { type: "submit", form: "new-booking" }, t("Save booking"));
  const close = sheet(t("New booking"), form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    save.disabled = true;
    try {
      const body = { ...Object.fromEntries(new FormData(form)), location, source };
      if (location !== "mobile") delete body.address;
      const { booking } = await api("/api/bookings", { method: "POST", body });
      close();
      toast(t("Booking {ref} saved.", { ref: booking.ref }));
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
      toast(MOVED[status] || t("Booking updated."));
      await reload();
    } catch (err) { toast(err.message, "bad"); }
  }

  // ---- customer ----
  const customerCard = h("section.card.stack",
    h("h2.h2", t("Customer")),
    h("a", { href: `#/customers/${c.id}`, style: "font-weight:600;font-size:18px;text-decoration:none" }, c.name),
    h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
      c.phone ? h("a.btn.primary", { href: `tel:${c.phone}` }, icon("phone"), fmtPhone(c.phone)) : null,
      c.email ? h("a.btn", { href: `mailto:${c.email}` }, t("Email")) : null,
    ),
    c.email ? h("p.small.muted", { style: "margin:0" }, c.email) : null,
    !c.phone && !c.email ? h("p.muted", { style: "margin:0" }, t("No contact details saved.")) : null,
  );

  // ---- vehicle ----
  const vehicleCard = h("section.card.stack", h("h2.h2", t("Vehicle")));
  if (v) {
    vehicleCard.append(
      h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" }, plate(v.reg), h("strong", carName(v) || t("Details not looked up yet"))),
      h("dl.kv",
        h("dt", "MOT"), h("dd", v.mot_expiry ? `${v.mot_status || ""} ${v.mot_status ? "· " : ""}${t("expires {date}", { date: fmtDate(v.mot_expiry) })}` : v.mot_status || t("Unknown")),
        h("dt", t("Tax")), h("dd", v.tax_status ? `${v.tax_status}${v.tax_due ? ` · ${t("due {date}", { date: fmtDate(v.tax_due) })}` : ""}` : t("Unknown")),
        h("dt", t("Mileage")), h("dd", v.last_mileage ? fmtMiles(v.last_mileage) : t("Unknown")),
        h("dt", t("Engine")), h("dd", [v.engine_cc ? `${v.engine_cc} cc` : null, v.fuel_type].filter(Boolean).join(" · ") || t("Unknown")),
        h("dt", "VIN"), h("dd.mono", v.vin || t("Not recorded")),
      ),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
        h("button.btn.small", { type: "button", onclick: () => editVehicle(v, reload) }, t("Edit VIN / mileage")),
        h("button.btn.small.ghost", { type: "button", onclick: async e => {
          e.currentTarget.disabled = true;
          try {
            const { lookup } = await api(`/api/vehicles/${v.id}/refresh`, { method: "POST" });
            toast(lookup?.found ? t("Vehicle details refreshed.") : t("No new details: the lookup isn't connected or found nothing."));
            await reload();
          } catch (err) { toast(err.message, "bad"); e.currentTarget.disabled = false; }
        } }, t("Refresh details")),
      ),
    );
  } else {
    vehicleCard.append(h("p.muted", { style: "margin:0" }, t("No registration on this booking yet. Add one by editing the booking details or the job card.")));
  }

  // ---- booking details ----
  const detailsCard = h("section.card.stack",
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px" }, h("h2.h2", t("Booking")),
      h("button.btn.small", { type: "button", onclick: () => editBooking(b, reload) }, t("Edit"))),
    h("dl.kv",
      h("dt", t("Service")), h("dd", serviceLabel(b.service)),
      h("dt", t("Where")), h("dd", b.location === "mobile" ? t("Mobile: {address}", { address: b.address || t("address not given") }) : t("At the workshop")),
      h("dt", t("Asked for")), h("dd", b.preferred_date ? fmtDate(b.preferred_date) : t("Any time")),
      h("dt", t("Booked for")), h("dd", b.scheduled_start ? t("{start} to {end}", { start: fmtDateTime(b.scheduled_start), end: fmtDateTime(b.scheduled_end).split(", ").pop() }) : t("Not confirmed yet")),
      h("dt", t("Came from")), h("dd", SOURCE_LABELS[b.source] || b.source),
      h("dt", t("Received")), h("dd", fmtDateTime(b.created_at)),
    ),
    h("div.stack", { style: "gap:6px" }, h("strong", t("What they said")), b.description ? translatable(b.description) : h("p", { style: "margin:0" }, t("Nothing added."))),
  );

  // ---- next steps ----
  const actions = h("section.card.stack", h("h2.h2", t("Next step")));
  if (b.status === "requested" || b.status === "confirmed") {
    const start = b.scheduled_start ? new Date(b.scheduled_start) : null;
    const confirmForm = h("form.form", { novalidate: true },
      h("div.form-row",
        field(t("Date"), h("input.input", { name: "date", type: "date", required: true, value: start ? localDate(start) : (b.preferred_date && b.preferred_date >= today() ? b.preferred_date : tomorrow()) })),
        field(t("Time"), h("input.input", { name: "time", type: "time", required: true, step: 900, value: start ? localTime(start) : "09:00" })),
        field(t("Until (optional)"), h("input.input", { name: "end", type: "time", step: 900, value: b.scheduled_end ? localTime(new Date(b.scheduled_end)) : "" })),
      ),
      h("div", h("button.btn.primary", { type: "submit" }, b.status === "confirmed" ? t("Reschedule") : t("Confirm booking"))),
    );
    confirmForm.addEventListener("submit", async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(confirmForm));
      if (!f.date || !f.time) { toast(t("Pick a date and a time."), "bad"); return; }
      const body = { scheduled_start: new Date(`${f.date}T${f.time}`).toISOString() };
      if (f.end) body.scheduled_end = new Date(`${f.date}T${f.end}`).toISOString();
      try {
        await api(`/api/bookings/${b.id}/confirm`, { method: "POST", body });
        toast(b.status === "confirmed" ? t("Booking moved. The customer will be told.") : t("Booking confirmed. The customer will be told."));
        await reload();
      } catch (err) {
        showFieldErrors(confirmForm, { fields: { end: err.fields?.scheduled_end, date: err.fields?.scheduled_start } });
        toast(err.message, "bad");
      }
    });
    actions.append(confirmForm);
  }
  const moves = (transitions || []).filter(s => !(s === "confirmed" && b.status === "requested"));
  if (moves.length) {
    actions.append(h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, moves.map(s =>
      h("button.btn", { type: "button", class: s === "cancelled" || s === "no_show" ? "danger" : s === "in_progress" || s === "completed" ? "primary" : "", onclick: () => move(s) }, MOVE_LABELS[s] || s))));
  }
  if (!moves.length && !["requested", "confirmed"].includes(b.status)) actions.append(h("p.muted", { style: "margin:0" }, t("This booking is closed.")));

  const jobBtn = job
    ? h("a.btn", { href: `#/jobs/${job.id}` }, icon("jobs"), t("Open job card {ref}", { ref: job.ref }))
    : ["requested", "confirmed", "in_progress"].includes(b.status)
      ? h("button.btn", { type: "button", onclick: async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api(`/api/jobs/from-booking/${b.id}`, { method: "POST" });
          const jobId = res.job?.id || res.id;
          if (!jobId) throw new Error(t("The job card didn't come back."));
          navigate(`#/jobs/${jobId}`);
        } catch (err) {
          toast(err.status === 404 || err.status === 405 ? t("Job cards aren't switched on yet.") : err.message, "bad");
          btn.disabled = false;
        }
      } }, icon("jobs"), t("Open job card"))
      : null;
  if (jobBtn) actions.append(h("div", jobBtn));

  // ---- internal notes ----
  const notes = h("textarea.input", { name: "internal_notes", rows: 4, maxlength: 4000, placeholder: t("Only the two of you see these.") }, b.internal_notes || "");
  const notesForm = h("form.form", field(t("Internal notes"), notes), h("div", h("button.btn", { type: "submit" }, t("Save notes"))));
  notesForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", body: { internal_notes: notes.value } });
      showFieldErrors(notesForm, null);
      toast(t("Notes saved."));
    } catch (err) { showFieldErrors(notesForm, err); toast(err.message, "bad"); }
  });

  view.replaceChildren(
    h("div", { style: "margin-bottom:10px" }, h("a.btn.small.ghost", { href: "#/bookings" }, icon("back"), t("Bookings"))),
    pageHead(`${b.ref} · ${serviceLabel(b.service)}`, c.name, statusChip(b.status)),
    h("div.grid-2", actions, detailsCard, customerCard, vehicleCard, h("section.card", notesForm)),
  );
}

function editBooking(b, reload) {
  let location = b.location;
  const address = field(t("Address for the visit"), h("textarea.input", { name: "address", rows: 2 }, b.address || ""));
  address.hidden = location !== "mobile";
  const form = h("form.form", { id: "edit-booking", novalidate: true },
    h("div.form-row",
      field(t("Service"), serviceSelect(b.service)),
      field(t("Preferred date"), h("input.input", { name: "preferred_date", type: "date", value: b.preferred_date || "" })),
    ),
    field(t("What does it need?"), h("textarea.input", { name: "description", rows: 4, maxlength: 2000 }, b.description || "")),
    h("div.field", h("span", t("Where")), segmented([["workshop", t("At the workshop")], ["mobile", t("Mobile visit")]], location, v => { location = v; address.hidden = v !== "mobile"; }).el),
    address,
  );
  const save = h("button.btn.primary", { type: "submit", form: "edit-booking" }, t("Save"));
  const close = sheet(t("Booking details"), form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), location };
    if (location !== "mobile") body.address = "";
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", body });
      close();
      toast(t("Booking updated."));
      await reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); }
  });
}

function editVehicle(v, reload) {
  const form = h("form.form", { id: "edit-vehicle", novalidate: true },
    field("VIN", h("input.input.mono", { name: "vin", value: v.vin || "", maxlength: 17, autocapitalize: "characters", autocomplete: "off", spellcheck: false }), t("17 characters, from the scan tool or the windscreen.")),
    field(t("Mileage"), h("input.input", { name: "last_mileage", inputmode: "numeric", value: v.last_mileage ?? "" })),
  );
  const save = h("button.btn.primary", { type: "submit", form: "edit-vehicle" }, t("Save"));
  const close = sheet(t("Vehicle {reg}", { reg: v.reg }), form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const body = { vin: f.vin, last_mileage: f.last_mileage === "" ? null : String(f.last_mileage).replace(/[,\s]/g, "") };
    try {
      await api(`/api/vehicles/${v.id}`, { method: "PATCH", body });
      close();
      toast(t("Vehicle saved."));
      await reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); }
  });
}
