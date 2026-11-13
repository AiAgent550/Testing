// Invoices and quotes: the list (unpaid, overdue, drafts), and one page per document that is both the editor and the
// place to send it, record payment, turn a quote into an invoice, or download the PDF.
//   #/invoices                       list
//   #/invoices/<id>                  one invoice or quote
//   #/invoices/new/<invoice|quote>[/<jobId>]
import { api, chip, empty, field, h, icon, loading, pageHead, segmented, showFieldErrors, t, toast } from "../core.js";
import { docChip, fmtDay, fmtMoney, fromPence, sendSheet, toPence } from "../send.js";

let listKind = "invoice", listFilter = "open";

export async function render(view, { params, navigate }) {
  if (params[0] === "new") return renderEditor(view, null, { kind: params[1] === "quote" ? "quote" : "invoice", jobId: params[2] || null, navigate });
  if (params[0]) return renderEditor(view, params[0], { navigate });
  return renderList(view, { navigate });
}

// ---------- list ----------
async function renderList(view, { navigate }) {
  const box = h("div");
  const summary = h("div");
  const filterBox = h("div");
  const kindSeg = segmented([["invoice", t("Invoices")], ["quote", t("Quotes")]], listKind, v => { listKind = v; listFilter = "open"; drawFilters(); load(); });
  const newBtn = h("button.btn.primary", { type: "button", onclick: () => navigate(`#/invoices/new/${listKind}`) }, icon("plus"), t("New"));
  view.replaceChildren(pageHead(t("Money"), t("Invoices"), newBtn), h("div.stack", kindSeg.el, filterBox, summary, box));

  function drawFilters() {
    const opts = listKind === "invoice"
      ? [["open", t("Open")], ["unpaid", t("Unpaid")], ["overdue", t("Overdue")], ["paid", t("Paid")], ["all", t("All")]]
      : [["open", t("Open")], ["all", t("All")]];
    filterBox.replaceChildren(segmented(opts, listFilter, v => { listFilter = v; load(); }).el);
  }
  drawFilters();

  let seq = 0;
  async function load() {
    const mine = ++seq;
    box.replaceChildren(loading());
    try {
      const res = await api(`/api/documents?kind=${listKind}&filter=${listFilter}`);
      if (mine !== seq) return;
      summary.replaceChildren(listKind === "invoice" && res.unpaid.count
        ? h("p.hint", t("{count} unpaid, {amount} to come in.", { count: res.unpaid.count, amount: fmtMoney(res.unpaid.pence) }))
        : null);
      if (!res.documents.length) {
        box.replaceChildren(empty(listKind === "invoice" ? t("No invoices here.") : t("No quotes here."), "invoice",
          h("button.btn", { type: "button", onclick: () => navigate(`#/invoices/new/${listKind}`) }, icon("plus"), listKind === "invoice" ? t("New invoice") : t("New quote"))));
        return;
      }
      box.replaceChildren(h("div.list", res.documents.map(d => h("a.row", { href: `#/invoices/${encodeURIComponent(d.id)}` },
        h("span.title", `${d.number} · ${d.bill_name}`),
        docChip(d),
        h("span.sub", [d.vehicle_reg, fmtDay(d.issue_date), fmtMoney(d.total_pence),
          d.kind === "invoice" && d.status === "sent" && d.balance_pence > 0 ? t("{amount} to pay", { amount: fmtMoney(d.balance_pence) }) : null].filter(Boolean).join(" · "))))));
    } catch (err) { if (mine === seq) box.replaceChildren(empty(err.message, "invoice")); }
  }
  load();
}

// ---------- one document ----------
const LINE_KINDS = () => [["part", t("Part")], ["labour", t("Labour")], ["other", t("Other")]];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function renderEditor(view, id, { kind, jobId, navigate }) {
  let doc, emails = [];
  if (id) {
    const res = await api(`/api/documents/${encodeURIComponent(id)}`);
    doc = res.document; emails = res.emails;
  } else {
    const pre = jobId ? await api(`/api/documents/prefill/${encodeURIComponent(jobId)}`) : {};
    doc = {
      id: null, kind, number: null, status: "draft", job_id: pre.job_id || null, customer_id: pre.customer_id || null,
      bill_name: pre.bill_name || "", bill_email: pre.bill_email, bill_phone: pre.bill_phone, bill_address: null,
      vehicle_reg: pre.vehicle_reg, vehicle_desc: pre.vehicle_desc, po_number: null,
      issue_date: today(), due_date: kind === "quote" ? addDays(today(), 30) : addDays(today(), 7), notes: null, paid_pence: 0,
      lines: [{ kind: "part", description: "", qty: 1, unit: null, unit_pence: null }, { kind: "labour", description: t("Labour"), qty: 1, unit: null, unit_pence: null }],
    };
  }
  const isInvoice = doc.kind === "invoice";
  const locked = doc.status === "void";
  const lines = doc.lines.map(l => ({ ...l }));

  // ---- fields ----
  const inp = (name, value, attrs = {}) => h("input.input", { name, value: value ?? "", disabled: locked, ...attrs });
  const billName = inp("bill_name", doc.bill_name, { maxlength: 200, required: true, placeholder: t("Customer or company name") });
  const billEmail = inp("bill_email", doc.bill_email, { type: "email", inputmode: "email", maxlength: 254 });
  const billPhone = inp("bill_phone", doc.bill_phone, { type: "tel", maxlength: 40 });
  const billAddress = h("textarea.input", { name: "bill_address", rows: 3, maxlength: 500, disabled: locked, style: "min-height:84px" }, doc.bill_address || "");
  const reg = inp("vehicle_reg", doc.vehicle_reg, { maxlength: 12, autocapitalize: "characters", style: "text-transform:uppercase" });
  const vehicle = inp("vehicle_desc", doc.vehicle_desc, { maxlength: 120, placeholder: t("e.g. 2016 Mercedes-Benz E220d") });
  const po = inp("po_number", doc.po_number, { maxlength: 60, placeholder: t("If the customer gave one") });
  const issue = inp("issue_date", doc.issue_date, { type: "date" });
  const terms = h("select.input", { name: "terms", disabled: locked });
  const due = inp("due_date", doc.due_date, { type: "date" });
  const notes = h("textarea.input", { name: "notes", rows: 3, maxlength: 2000, disabled: locked, style: "min-height:84px", placeholder: t("Printed on the document, e.g. warranty or parts returned") }, doc.notes || "");
  const paid = inp("paid_pence", doc.paid_pence ? fromPence(doc.paid_pence) : "", { inputmode: "decimal", placeholder: "0.00" });
  const markup = h("input.input", { inputmode: "decimal", value: "12", style: "max-width:90px", disabled: locked });

  if (isInvoice) {
    const choices = [["0", t("Due on receipt")], ["7", t("7 days")], ["14", t("14 days")], ["30", t("30 days")], ["custom", t("Pick a date")]];
    const diff = doc.due_date ? Math.round((Date.parse(doc.due_date) - Date.parse(doc.issue_date)) / 86400000) : 0;
    const current = !doc.due_date ? "0" : ["7", "14", "30"].includes(String(diff)) ? String(diff) : "custom";
    choices.forEach(([v, label]) => terms.append(h("option", { value: v, selected: v === current }, label)));
    const sync = () => {
      due.hidden = terms.value !== "custom";
      if (terms.value !== "custom") due.value = terms.value === "0" ? "" : addDays(issue.value || today(), Number(terms.value));
    };
    terms.addEventListener("change", sync);
    issue.addEventListener("change", sync);
    sync();
  }

  // ---- lines ----
  const linesBox = h("div.stack", { style: "gap:10px" });
  const totalsBox = h("div.stack", { style: "gap:6px" });
  function lineEditor(l, i) {
    const kindSel = h("select.input", { disabled: locked, onchange: () => { l.kind = kindSel.value; drawTotals(); } }, LINE_KINDS().map(([v, label]) => h("option", { value: v, selected: v === l.kind }, label)));
    const desc = h("input.input", { value: l.description, maxlength: 300, disabled: locked, placeholder: t("Description"), oninput: () => { l.description = desc.value; } });
    const qty = h("input.input", { value: l.qty ?? 1, inputmode: "decimal", disabled: locked, style: "text-align:right", oninput: () => { l.qty = Number(qty.value.replace(",", ".")) || 0; drawTotals(); } });
    const unit = h("input.input", { value: l.unit || "", maxlength: 12, disabled: locked, placeholder: t("unit"), oninput: () => { l.unit = unit.value.trim() || null; } });
    const price = h("input.input", { value: fromPence(l.unit_pence), inputmode: "decimal", disabled: locked, placeholder: "0.00", style: "text-align:right", oninput: () => { l.unit_pence = toPence(price.value); l.cost_pence = null; l.markup_pct = null; cost.value = ""; drawTotals(); } });
    const cost = h("input.input", { value: fromPence(l.cost_pence), inputmode: "decimal", disabled: locked, placeholder: t("cost"), style: "text-align:right", oninput: () => {
      const c = toPence(cost.value);
      const m = Number(markup.value.replace(",", ".")) || 0;
      l.cost_pence = c; l.markup_pct = c === null ? null : m;
      if (c !== null) { l.unit_pence = Math.round(c * (1 + m / 100)); price.value = fromPence(l.unit_pence); }
      drawTotals();
    } });
    const remove = h("button.btn.small.ghost", { type: "button", disabled: locked, "aria-label": t("Remove line"), onclick: () => { lines.splice(i, 1); drawLines(); } }, "×");
    return h("div", { style: "display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--raise)" },
      h("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px" }, desc, remove),
      h("div", { style: "display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr);gap:8px" },
        h("label.field", h("span", t("Type")), kindSel),
        h("label.field", h("span", t("Qty")), qty),
        h("label.field", h("span", t("Unit")), unit)),
      h("div", { style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px" },
        l.kind === "part" ? h("label.field", h("span", t("Our cost £")), cost) : h("span"),
        h("label.field", h("span", t("Price £")), price)));
  }
  function drawLines() {
    linesBox.replaceChildren(lines.map(lineEditor),
      locked ? null : h("div", { style: "display:flex;flex-wrap:wrap;gap:8px" },
        h("button.btn.small", { type: "button", onclick: () => { lines.push({ kind: "part", description: "", qty: 1, unit: null, unit_pence: null }); drawLines(); linesBox.querySelectorAll("input")[Math.max(0, linesBox.querySelectorAll("input").length - 6)]?.focus(); } }, icon("plus"), t("Add part")),
        h("button.btn.small", { type: "button", onclick: () => { lines.push({ kind: "labour", description: t("Labour"), qty: 1, unit: null, unit_pence: null }); drawLines(); } }, icon("plus"), t("Add labour"))));
    drawTotals();
  }
  function drawTotals() {
    const sum = k => lines.filter(l => !k || l.kind === k).reduce((n, l) => n + Math.round((l.qty || 0) * (l.unit_pence || 0)), 0);
    const total = sum();
    const paidP = toPence(paid.value) || 0;
    const row = (k, v, strong) => h("div", { style: `display:flex;justify-content:space-between;gap:12px;${strong ? "font-weight:700;font-size:18px" : ""}` }, h("span", k), h("span", v));
    totalsBox.replaceChildren(
      row(t("Parts"), fmtMoney(sum("part"))), row(t("Labour"), fmtMoney(sum("labour"))), sum("other") ? row(t("Other"), fmtMoney(sum("other"))) : null,
      row(t("Total"), fmtMoney(total), !isInvoice),
      isInvoice && paidP ? row(t("Paid"), `-${fmtMoney(paidP)}`) : null,
      isInvoice ? row(t("Balance due"), fmtMoney(total - paidP), true) : null,
      h("p.muted.small", { style: "margin:0" }, t("Not VAT registered, so no VAT is added.")));
  }
  paid.addEventListener("input", drawTotals);
  drawLines();

  // ---- save ----
  const form = h("form.form", { id: "doc-form", novalidate: true });
  function body() {
    const clean = lines.filter(l => l.description.trim() || l.unit_pence);
    return {
      ...(doc.id ? {} : { kind: doc.kind }),
      job_id: doc.job_id, customer_id: doc.customer_id,
      bill_name: billName.value.trim(), bill_email: billEmail.value.trim() || null, bill_phone: billPhone.value.trim() || null,
      bill_address: billAddress.value.trim() || null, vehicle_reg: reg.value.trim() || null, vehicle_desc: vehicle.value.trim() || null,
      po_number: po.value.trim() || null, issue_date: issue.value || today(),
      due_date: isInvoice ? (terms.value === "0" ? null : due.value || null) : due.value || null,
      notes: notes.value.trim() || null,
      paid_pence: isInvoice ? toPence(paid.value) || 0 : 0,
      lines: clean.map(l => ({ kind: l.kind, description: l.description.trim(), qty: l.qty || 1, unit: l.unit, unit_pence: l.unit_pence ?? 0, cost_pence: l.cost_pence ?? null, markup_pct: l.markup_pct ?? null })),
    };
  }
  async function save({ quiet = false } = {}) {
    showFieldErrors(form, null);
    const b = body();
    if (!b.bill_name) { showFieldErrors(form, { fields: { bill_name: t("Required.") } }); throw new Error(t("Add who it's for.")); }
    if (!b.lines.length) throw new Error(t("Add at least one line."));
    if (lines.some(l => l.description.trim() && (l.unit_pence === null || l.unit_pence === undefined))) throw new Error(t("Every line needs a price."));
    const res = doc.id
      ? await api(`/api/documents/${encodeURIComponent(doc.id)}`, { method: "PATCH", body: b })
      : await api("/api/documents", { method: "POST", body: b });
    if (!quiet) toast(doc.id ? t("Saved.") : t("{number} created.", { number: res.document.number }));
    return res.document;
  }
  const saveBtn = h("button.btn.primary", { type: "submit", form: "doc-form", disabled: locked }, doc.id ? t("Save changes") : isInvoice ? t("Create invoice") : t("Create quote"));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      const saved = await save();
      if (!doc.id) return navigate(`#/invoices/${saved.id}`);
      renderEditor(view, doc.id, { navigate });
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); saveBtn.disabled = false; }
  });

  // ---- actions on a saved document ----
  const act = (label, iconName, fn, cls = "btn") => h(`button.${cls.split(" ").join(".")}`, { type: "button", onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, "bad"); } finally { btn.disabled = false; }
  } }, iconName ? icon(iconName) : null, label);
  const setStatus = async (status, msg) => { await api(`/api/documents/${encodeURIComponent(doc.id)}/status`, { method: "POST", body: { status } }); toast(msg); renderEditor(view, doc.id, { navigate }); };
  const actions = doc.id ? h("div", { style: "display:flex;flex-wrap:wrap;gap:8px" },
    locked ? null : act(t("Email to customer"), "send", async () => {
      const saved = await save({ quiet: true });
      const purpose = !isInvoice ? "quote" : saved.overdue ? "reminder" : "invoice";
      let job = null;
      if (saved.job_id) job = await api(`/api/jobs/${encodeURIComponent(saved.job_id)}`).catch(() => null);
      sendSheet({ purpose, job, doc: saved, onSent: () => renderEditor(view, doc.id, { navigate }) });
    }, "btn primary"),
    h("a.btn", { href: `/api/documents/${encodeURIComponent(doc.id)}/pdf`, target: "_blank", rel: "noopener" }, icon("invoice"), t("View PDF")),
    h("a.btn", { href: `/api/documents/${encodeURIComponent(doc.id)}/pdf?download=1` }, t("Download")),
    isInvoice && !locked && doc.status !== "paid" ? act(t("Mark paid"), null, () => setStatus("paid", t("Marked as paid."))) : null,
    isInvoice && doc.status === "draft" ? act(t("Mark sent"), null, () => setStatus("sent", t("Marked as sent."))) : null,
    !isInvoice && !locked ? act(t("Turn into invoice"), null, async () => {
      const res = await api(`/api/documents/${encodeURIComponent(doc.id)}/convert`, { method: "POST" });
      toast(res.created ? t("{number} created.", { number: res.document.number }) : t("Opening {number}.", { number: res.document.number }));
      navigate(`#/invoices/${res.document.id}`);
    }) : null,
    !isInvoice && doc.status === "sent" ? act(t("Declined"), null, () => setStatus("declined", t("Marked as declined."))) : null,
    doc.status === "draft" && !doc.sent_at ? act(t("Delete draft"), null, async () => {
      if (!confirm(t("Delete this draft?"))) return;
      await api(`/api/documents/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
      toast(t("Draft deleted."));
      navigate("#/invoices");
    }, "btn danger") : !locked ? act(t("Void"), null, async () => {
      if (!confirm(t("Void {number}? It stays on record but can't be sent or paid.", { number: doc.number }))) return;
      await setStatus("void", t("{number} is void.", { number: doc.number }));
    }, "btn danger") : null,
  ) : null;

  const sentList = emails.length ? h("section.card.stack", h("h2.h2", t("Emails sent")), h("div.list", emails.map(e => h("div.row",
    h("span.title", e.subject), chip(e.status === "sent" ? "sent" : "failed"),
    h("span.sub", [e.to_email, fmtDay(e.created_at.slice(0, 10)), e.error].filter(Boolean).join(" · ")))))) : null;

  form.append(
    h("section.card.stack",
      h("h2.h2", isInvoice ? t("Bill to") : t("Quote for")),
      field(t("Name"), billName),
      h("div.form-row", field(t("Email"), billEmail), field(t("Phone"), billPhone)),
      field(t("Address"), billAddress, t("Optional. Companies usually want it.")),
      h("div.form-row", field(t("Registration"), reg), field(t("Vehicle"), vehicle))),
    h("section.card.stack",
      h("h2.h2", t("Details")),
      h("div.form-row", field(t("Date"), issue), isInvoice ? field(t("Payment terms"), h("div.stack", { style: "gap:8px" }, terms, due)) : field(t("Valid until"), due)),
      field(t("PO / order number"), po)),
    h("section.card.stack",
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" },
        h("h2.h2", t("Lines")),
        h("label", { style: "display:flex;align-items:center;gap:8px" }, h("span.muted.small", t("Markup on parts %")), markup)),
      h("p.muted.small", { style: "margin:0" }, t("Type our cost on a part and the price is worked out with the markup. Costs are never printed.")),
      linesBox),
    h("section.card.stack",
      h("h2.h2", t("Totals")),
      isInvoice ? field(t("Already paid (deposit) £"), paid) : null,
      totalsBox,
      field(t("Notes"), notes)),
  );

  view.replaceChildren(
    h("div.stack", { style: "gap:12px;margin-bottom:18px" },
      h("div", { style: "display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap" },
        h("a.btn.small.ghost", { href: doc.job_id ? `#/jobs/${encodeURIComponent(doc.job_id)}` : "#/invoices", style: "padding-left:4px" }, icon("back"), doc.job_id ? t("Job") : t("Invoices")),
        doc.id ? docChip(doc) : null),
      pageHead(isInvoice ? t("Invoice") : t("Quote"), doc.number || (isInvoice ? t("New invoice") : t("New quote"))),
      doc.id && isInvoice && doc.status !== "draft" ? h("p.hint", doc.balance_pence > 0
        ? t("{amount} to pay{due}.", { amount: fmtMoney(doc.balance_pence), due: doc.due_date ? ` · ${t("due {date}", { date: fmtDay(doc.due_date) })}` : "" })
        : t("Paid in full.")) : null,
      actions),
    h("div.grid-2", { style: "align-items:start" }, form, h("div.stack", sentList)),
    locked ? null : h("div", { style: "position:sticky;bottom:calc(var(--tabbar) + env(safe-area-inset-bottom, 0px) + 12px);display:flex;justify-content:flex-end;margin-top:16px" }, saveBtn),
  );
  document.title = `${doc.number || (isInvoice ? t("New invoice") : t("New quote"))} · Curve Hub`;
}
