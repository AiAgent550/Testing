// Customers: find anyone by name, phone, email or registration; see their cars and booking history.
import {
  SERVICE_LABELS, api, chip, empty, field, fmtDate, fmtDateTime, fmtMiles, fmtPhone, h, icon, loading,
  pageHead, plate, sheet, showFieldErrors, t, tn, toast, translatable,
} from "../core.js";

const STATUS_LABELS = {
  requested: t("Request"), confirmed: t("Confirmed"), in_progress: t("In progress"), completed: t("Completed"), cancelled: t("Cancelled"), no_show: t("No-show"),
};
const SOURCE_LABELS = { website: t("Website"), phone: t("Phone"), social: t("Social media"), walk_in: t("Walk-in"), other: t("Other") };

let query = "";

export async function render(view, ctx) {
  if (ctx.params[0]) return renderDetail(view, ctx.params[0], ctx);
  return renderList(view, ctx);
}

function debounce(fn, ms) {
  let tm;
  return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); };
}

function carName(v) {
  const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return [name, v.colour ? String(v.colour).toLowerCase() : null].filter(Boolean).join(", ");
}

// ---------- list ----------
async function renderList(view, { navigate }) {
  const listBox = h("div");
  const search = h("input.input", { type: "search", placeholder: t("Name, phone, email or registration"), value: query, "aria-label": t("Search customers"), autocomplete: "off" });
  let seq = 0;

  async function load() {
    const mine = ++seq;
    listBox.replaceChildren(loading());
    try {
      const { customers } = await api(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (mine !== seq) return;
      if (!customers.length) { listBox.replaceChildren(empty(query ? t("Nobody matches that search.") : t("No customers yet. They're added automatically with each booking."), "customers")); return; }
      listBox.replaceChildren(
        query ? null : h("p.small.muted", { style: "margin:0 0 10px" }, t("Recently active")),
        h("div.list", customers.map(c => h("a.row", { href: `#/customers/${c.id}` },
          h("span.title", c.name),
          h("span", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:end" }, (c.regs ? c.regs.split(",") : []).slice(0, 2).map(plate)),
          h("span.sub", [fmtPhone(c.phone), c.email, c.booking_count ? tn(c.booking_count, "{n} booking|{n} bookings") : null].filter(Boolean).join(" · ") || t("No contact details")),
        ))),
      );
    } catch (err) {
      if (mine === seq) listBox.replaceChildren(empty(err.message, "customers"));
    }
  }

  search.addEventListener("input", debounce(() => { query = search.value.trim(); load(); }, 300));
  view.replaceChildren(
    pageHead("Curve Hub", t("Customers"), h("button.btn", { type: "button", onclick: () => editCustomer(null, c => navigate(`#/customers/${c.id}`)) }, icon("plus"), t("Add customer"))),
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
    h("h2.h2", t("Contact")),
    h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
      c.phone ? h("a.btn.primary", { href: `tel:${c.phone}` }, icon("phone"), fmtPhone(c.phone)) : null,
      c.email ? h("a.btn", { href: `mailto:${c.email}` }, t("Email")) : null,
    ),
    h("dl.kv",
      h("dt", t("Phone")), h("dd", c.phone ? fmtPhone(c.phone) : t("Not saved")),
      h("dt", t("Email")), h("dd", c.email || t("Not saved")),
      h("dt", t("First contact")), h("dd", `${SOURCE_LABELS[c.source] || c.source}, ${fmtDate(c.created_at)}`),
    ),
    h("div.stack", { style: "gap:6px" }, h("strong", t("Notes")), c.notes ? translatable(c.notes) : h("p", { style: "margin:0" }, t("No notes."))),
  );

  const cars = h("section.card.stack", h("h2.h2", t("Vehicles")),
    vehicles.length
      ? h("div.list", vehicles.map(v => h("div.row",
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(v.reg), carName(v) || t("Details not looked up")),
        v.mot_expiry ? chip(Date.parse(v.mot_expiry) < Date.now() ? "failed" : "sent", `MOT ${fmtDate(v.mot_expiry)}`) : h("span"),
        h("span.sub", [v.last_mileage ? fmtMiles(v.last_mileage) : null, v.vin ? `VIN ${v.vin}` : null, v.tax_status ? t("Tax: {status}", { status: v.tax_status.toLowerCase() }) : null].filter(Boolean).join(" · ") || t("No extra details yet")),
      )))
      : h("p.muted", { style: "margin:0" }, t("No cars saved for this customer yet.")),
  );

  const history = h("section.card.stack", h("h2.h2", t("Bookings")),
    bookings.length
      ? h("div.list", bookings.map(b => h("a.row", { href: `#/bookings/${b.id}` },
        h("span.title", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, plate(b.reg), `${b.ref} · ${SERVICE_LABELS[b.service] || b.service}`),
        chip(b.status, STATUS_LABELS[b.status]),
        h("span.sub", b.scheduled_start ? fmtDateTime(b.scheduled_start) : b.preferred_date ? t("Asked for {date}", { date: fmtDate(b.preferred_date) }) : t("Received {when}", { when: fmtDate(b.created_at) })),
      )))
      : h("p.muted", { style: "margin:0" }, t("No bookings yet.")),
  );

  view.replaceChildren(
    h("div", { style: "margin-bottom:10px" }, h("a.btn.small.ghost", { href: "#/customers" }, icon("back"), t("Customers"))),
    pageHead(t("Customer"), c.name, h("button.btn", { type: "button", onclick: () => editCustomer(c, reload) }, t("Edit"))),
    h("div.grid-2", contact, cars, history),
  );
}

/** Add (c = null) or edit a customer. */
function editCustomer(c, after) {
  const form = h("form.form", { id: "customer-form", novalidate: true },
    field(t("Name"), h("input.input", { name: "name", value: c?.name || "", autocomplete: "off", required: true })),
    h("div.form-row",
      field(t("Phone"), h("input.input", { name: "phone", type: "tel", inputmode: "tel", value: c?.phone ? fmtPhone(c.phone) : "", autocomplete: "off" })),
      field(t("Email"), h("input.input", { name: "email", type: "email", value: c?.email || "", autocomplete: "off" })),
    ),
    field(t("Notes"), h("textarea.input", { name: "notes", rows: 3, maxlength: 2000 }, c?.notes || "")),
  );
  const save = h("button.btn.primary", { type: "submit", form: "customer-form" }, c ? t("Save") : t("Add customer"));
  const close = sheet(c ? t("Edit customer") : t("New customer"), form, [save]);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    save.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const res = c
        ? await api(`/api/customers/${c.id}`, { method: "PATCH", body })
        : await api("/api/customers", { method: "POST", body: { ...body, source: "phone" } });
      close();
      toast(c ? t("Customer saved.") : res.matched ? t("They're already on file, so we opened their record.") : t("Customer added."));
      await after(res.customer);
    } catch (err) {
      showFieldErrors(form, err);
      toast(err.message, "bad");
    } finally { save.disabled = false; }
  });
}
