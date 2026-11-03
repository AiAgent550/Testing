// Shared pieces of the "Edit job" and "Edit booking" sheets: the registration field and the customer block
// (edit the linked customer's details, pick a different customer already in the Hub, or add a new one).
import { api, field, fmtPhone, formatReg, h, t } from "./core.js";

export const normReg = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Registration input that upper-cases as you type; `hint` explains what a change does. */
export function regField(current) {
  const input = h("input.input.reg", {
    name: "reg", maxlength: 10, autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
    placeholder: "AB12 CDE", value: current ? formatReg(current) : "",
  });
  input.addEventListener("input", () => { input.value = input.value.toUpperCase(); });
  const el = field(t("Registration"), input, t("Fixing a typo corrects the car. A plate already in the Hub links to that car instead."));
  return { el, input, changed: () => normReg(input.value) !== normReg(current), value: () => normReg(input.value) };
}

/**
 * Customer block. `current` is the linked customer (or null). `allowNone` lets a job have no customer.
 * resolve() returns { customerId, patch } where patch holds edits to the linked customer's own details,
 * creating a new customer first when that was chosen. Field errors use names cust_name/cust_phone/cust_email/customer_id.
 */
export function customerBlock(current) {
  let mode = current ? "edit" : "pick";
  let picked = null;
  const box = h("div.stack", { style: "gap:12px" });

  const name = h("input.input", { name: "cust_name", maxlength: 120, autocomplete: "off", value: current?.name || "" });
  const phone = h("input.input", { name: "cust_phone", type: "tel", inputmode: "tel", maxlength: 20, autocomplete: "off", value: current?.phone ? fmtPhone(current.phone) : "" });
  const email = h("input.input", { name: "cust_email", type: "email", maxlength: 160, autocomplete: "off", value: current?.email || "" });
  const search = h("input.input", { name: "customer_id", type: "search", autocomplete: "off", placeholder: t("Name, phone, email or registration") });
  const results = h("div.list");

  let seq = 0;
  async function runSearch() {
    const mine = ++seq;
    const q = search.value.trim();
    try {
      const { customers } = await api(`/api/customers?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      results.replaceChildren(...customers.slice(0, 8).map(c => h("button.row", {
        type: "button", style: "text-align:left;width:100%;cursor:pointer;min-height:44px",
        onclick: () => { picked = c; draw(); },
      }, h("span.title", c.name), h("span.sub", [c.phone ? fmtPhone(c.phone) : null, c.regs ? c.regs.split(",").map(formatReg).join(", ") : null].filter(Boolean).join(" · ") || t("No contact details saved.")))));
      if (!customers.length) results.replaceChildren(h("p.muted.small", { style: "margin:0" }, t("No customers match that.")));
    } catch { /* the search is a convenience */ }
  }
  search.addEventListener("input", runSearch);

  const link = (text, to) => h("button.btn.small.ghost", { type: "button", onclick: () => { mode = to; picked = null; draw(); if (to === "pick") runSearch(); } }, text);

  function draw() {
    if (mode === "edit") {
      box.replaceChildren(
        field(t("Name"), name), h("div.form-row", field(t("Phone"), phone), field(t("Email"), email)),
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, link(t("Different customer"), "pick")),
      );
    } else if (mode === "new") {
      box.replaceChildren(
        field(t("Name"), name), h("div.form-row", field(t("Phone"), phone), field(t("Email"), email)),
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, link(t("Pick an existing customer"), "pick"), current ? link(t("Keep {name}", { name: current.name }), "edit") : null),
      );
    } else if (picked) {
      box.replaceChildren(
        h("div.row", h("span.title", picked.name), h("span.sub", picked.phone ? fmtPhone(picked.phone) : t("No phone number"))),
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, h("button.btn.small.ghost", { type: "button", onclick: () => { picked = null; draw(); runSearch(); } }, t("Change"))),
      );
    } else {
      box.replaceChildren(
        field(t("Find customer"), search), results,
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
          link(t("New customer"), "new"), current ? link(t("Keep {name}", { name: current.name }), "edit") : null),
      );
    }
  }
  draw();

  async function resolve() {
    if (mode === "edit") {
      const patch = {};
      if (name.value.trim() !== (current.name || "")) patch.name = name.value.trim();
      if (normPhone(phone.value) !== normPhone(current.phone ? fmtPhone(current.phone) : "")) patch.phone = phone.value.trim();
      if (email.value.trim().toLowerCase() !== (current.email || "").toLowerCase()) patch.email = email.value.trim();
      return { customerId: current.id, patch };
    }
    if (mode === "new") {
      if (!name.value.trim()) throw fieldError("cust_name", t("Required."));
      try {
        const { customer } = await api("/api/customers", { method: "POST", body: { name: name.value.trim(), phone: phone.value.trim() || undefined, email: email.value.trim() || undefined } });
        return { customerId: customer.id, patch: {} };
      } catch (err) { throw prefixed(err); }
    }
    if (picked) return { customerId: picked.id, patch: {} };
    if (current) return { customerId: current.id, patch: {} };
    return { customerId: null, patch: {} };
  }

  /** Saves edits to the linked customer's own details (name/phone/email). */
  async function saveDetails(customerId, patch) {
    if (!customerId || !Object.keys(patch).length) return false;
    try { await api(`/api/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", body: patch }); }
    catch (err) { throw prefixed(err); }
    return true;
  }

  return { el: box, resolve, saveDetails };
}

const normPhone = s => String(s || "").replace(/[^\d+]/g, "");
function fieldError(name, message) { const e = new Error(message); e.fields = { [name]: message }; return e; }
/** Customer API errors name fields name/phone/email; the sheet's inputs are cust_*. */
function prefixed(err) {
  if (err?.fields) err.fields = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [["name", "phone", "email"].includes(k) ? `cust_${k}` : k, v]));
  return err;
}

/** Toast text for what a registration change did (server returns reg_change). */
export const REG_OUTCOME = {
  corrected: () => t("Registration corrected."),
  relinked: () => t("Linked to the car already in the Hub."),
  created: () => t("New car added for that registration."),
  cleared: () => t("Car unlinked."),
};
