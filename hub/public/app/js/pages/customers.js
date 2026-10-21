// Customers: find anyone by name, phone, email or registration; see their cars and booking history.
import {
  SERVICE_LABELS, api, chip, empty, field, fmtDate, fmtDateTime, fmtPhone, h, icon, loading,
  pageHead, plate, sheet, showFieldErrors, toast,
} from "../core.js";

const STATUS_LABELS = {
  requested: "Request", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", no_show: "No-show",
};
const SOURCE_LABELS = { website: "Website", phone: "Phone", social: "Social media", walk_in: "Walk-in", other: "Other" };

let query = "";

export async function render(view, ctx) {
  if (ctx.params[0]) return renderDetail(view, ctx.params[0], ctx);
  return renderList(view, ctx);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function carName(v) {
  const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return [name, v.colour ? String(v.colour).toLowerCase() : null].filter(Boolean).join(", ");
}

// ---------- list ----------
async function renderList(view, { navigate }) {
  const listBox = h("div");
  const search = h("input.input", { type: "search", placeholder: "Name, phone, email or registration", value: query, "aria-label": "Search customers", autocomplete: "off" });
  let seq = 0;

  async function load() {
    const mine = ++seq;
    listBox.replaceChildren(loading());
    try {
      const { customers } = await api(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (mine !== seq) return;
      if (!customers.length) { listBox.replaceChildren(empty(query ? "Nobody matches that search." : "No customers yet. They're added automatically with each booking.", "customers")); return; }
      listBox.replaceChildren(
        query ? null : h("p.small.muted", { style: "margin:0 0 10px" }, "Recently active"),
        h("div.list", customers.map(c => h("a.row", { href: `#/customers/${c.id}` },
          h("span.title", c.name),
          h("span", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:end" }, (c.regs ? c.regs.split(",") : []).slice(0, 2).map(plate)),
          h("span.sub", [fmtPhone(c.phone), c.email, c.booking_count ? `${c.booking_count} booking${c.booking_count === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No contact details"),
        ))),
      );
    } catch (err) {
      if (mine === seq) listBox.replaceChildren(empty(err.message, "customers"));
    }
  }

  search.addEventListener("input", debounce(() => { query = search.value.trim(); load(); }, 300));
  view.replaceChildren(
    pageHead("M&K Hub", "Customers", h("button.btn", { type: "button", onclick: () => editCustomer(null, c => navigate(`#/customers/${c.id}`)) }, icon("plus"), "Add customer")),
    h("div.stack", search, listBox),
  );
  search.focus();
  await load();
}

// ---------- detail ----------
async function renderDetail(view, id, ctx) {
  const { customer: c, vehicles, bookings } = await api(`/api/customers/${encodeURIComponent(id)}`);
  const reload = () => renderDetail(view, id, ctx);

  const contact = h("section.card.stack",
    h("h2.h2", "Contact"),
    h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
      c.phone ? h("a.btn.primary", { href: `tel:${c.phone}` }, icon("phone"), fmtPhone(c.phone)) : null,
      c.email ? h("a.btn", { href: `mailto:${c.email}` }, "Email") : null,
    ),
    h("dl.kv",
      h("dt", "Phone"), h("dd", c.phone ? fmtPhone(c.phone) : "Not saved"),
      h("dt", "Email"), h("dd", c.email || "Not saved"),
      h("dt", "First contact"), h("dd", `${SOURCE_LABELS[c.source] || c.source}, ${fmtDate(c.created_at)}`),
    ),
    h("div.stack", { style: "gap:6px" }, h("strong", "Notes"), h("p", { style: "margin:0;white-space:pre-wrap" }, c.notes || "No notes.")),
  );

  const cars = h("section.card.stack", h("h2.h2", "Vehicles"),
    vehicles.length
      ? h("div.list", vehicles.map(v => h("div.row",
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(v.reg), carName(v) || "Details not looked up"),
        v.mot_expiry ? chip(Date.parse(v.mot_expiry) < Date.now() ? "failed" : "sent", `MOT ${fmtDate(v.mot_expiry)}`) : h("span"),
        h("span.sub", [v.last_mileage ? `${Number(v.last_mileage).toLocaleString("en-GB")} miles` : null, v.vin ? `VIN ${v.vin}` : null, v.tax_status ? `Tax: ${v.tax_status.toLowerCase()}` : null].filter(Boolean).join(" · ") || "No extra details yet"),
      )))
      : h("p.muted", { style: "margin:0" }, "No cars saved for this customer yet."),
  );

  const history = h("section.card.stack", h("h2.h2", "Bookings"),
    bookings.length
      ? h("div.list", bookings.map(b => h("a.row", { href: `#/bookings/${b.id}` },
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(b.reg), `${b.ref} · ${SERVICE_LABELS[b.service] || b.service}`),
        chip(b.status, STATUS_LABELS[b.status]),
        h("span.sub", b.scheduled_start ? fmtDateTime(b.scheduled_start) : b.preferred_date ? `Asked for ${fmtDate(b.preferred_date)}` : `Received ${fmtDate(b.created_at)}`),
      )))
      : h("p.muted", { style: "margin:0" }, "No bookings yet."),
  );

  view.replaceChildren(
    h("div", { style: "margin-bottom:10px" }, h("a.btn.small.ghost", { href: "#/customers" }, icon("back"), "Customers")),
    pageHead("Customer", c.name, h("button.btn", { type: "button", onclick: () => editCustomer(c, reload) }, "Edit")),
    h("div.grid-2", contact, cars, history),
  );
}

/** Add (c = null) or edit a customer. */
function editCustomer(c, after) {
  const form = h("form.form", { id: "customer-form", novalidate: true },
    field("Name", h("input.input", { name: "name", value: c?.name || "", autocomplete: "off", required: true })),
    h("div.form-row",
      field("Phone", h("input.input", { name: "phone", type: "tel", inputmode: "tel", value: c?.phone ? fmtPhone(c.phone) : "", autocomplete: "off" })),
      field("Email", h("input.input", { name: "email", type: "email", value: c?.email || "", autocomplete: "off" })),
    ),
    field("Notes", h("textarea.input", { name: "notes", rows: 3, maxlength: 2000 }, c?.notes || "")),
  );
  const save = h("button.btn.primary", { type: "submit", form: "customer-form" }, c ? "Save" : "Add customer");
  const close = sheet(c ? "Edit customer" : "New customer", form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    save.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const res = c
        ? await api(`/api/customers/${c.id}`, { method: "PATCH", body })
        : await api("/api/customers", { method: "POST", body: { ...body, source: "phone" } });
      close();
      toast(c ? "Customer saved." : res.matched ? "They're already on file, so we opened their record." : "Customer added.");
      await after(res.customer);
    } catch (err) {
      showFieldErrors(form, err);
      toast(err.message, "bad");
    } finally { save.disabled = false; }
  });
}
