// Shared UI toolkit for every page. Pages import from here and nothing else,
// so the whole dashboard looks and behaves the same.

// Pages compose views from optional parts (`cond ? node : null`, arrays of rows). Native
// append/prepend/replaceChildren would print null as the text "null" and arrays as
// "[object ...]", so skip empty parts and flatten arrays everywhere in the dashboard.
for (const name of ["append", "prepend", "replaceChildren"]) {
  const native = Element.prototype[name];
  Element.prototype[name] = function (...parts) {
    return native.apply(this, parts.flat(Infinity).filter(p => p !== null && p !== undefined && p !== false));
  };
}

import { N_, getLang, locale, t, tServer, tn } from "/assets/i18n.js";
export { N_, getLang, locale, t, tn };

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ? tServer(body.error.message) : t("Request failed ({status}).", { status }));
    this.status = status;
    this.code = body?.error?.code;
    this.fields = Object.fromEntries(Object.entries(body?.error?.fields || {}).map(([k, v]) => [k, tServer(v)]));
  }
}

/** JSON API call. Redirects to sign-in when the session has ended. */
export async function api(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    credentials: "same-origin",
    headers: body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {},
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = "/login"; throw new ApiError(401, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- DOM ----------
/** h("div.card", { onclick }, child, "text") - tiny element builder. Children may be nodes, strings, arrays or null. */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style") el.style.cssText = v; // CSSOM, allowed under the strict CSP (style attributes are not)
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Inline line icons, same weight as the website's drawings. */
const ICONS = {
  today: '<path d="M4 7h16M4 7v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M8 3v4M16 3v4"/><path d="M8 13h3v3H8z"/>',
  bookings: '<path d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path d="M8 14l2.5 2.5L16 11"/>',
  jobs: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  leads: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  social: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  car: '<path d="M3 13l2-5.5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5L21 13v5h-2.5M3 13v5h2.5M3 13h18"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
};

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${cls}">${ICONS[name] || ""}</svg>`;
  return span.firstElementChild;
}

// ---------- feedback ----------
export function toast(message, kind = "") {
  const box = document.getElementById("toasts");
  const el = h("div.toast", { class: kind }, message);
  box.append(el);
  setTimeout(() => el.remove(), 4200);
}

export function loading() { return h("div.loading", h("div.spinner", { role: "progressbar", "aria-label": t("Loading") })); }

export function empty(text, iconName = "today", action = null) {
  const art = icon(iconName);
  for (const part of art.children) part.setAttribute("pathLength", "1"); // lets the line drawing draw itself in, as on the website
  return h("div.empty", art, h("p", { style: "margin:0" }, text), action);
}

const STATUS_TONE = {
  requested: "info", confirmed: "good", in_progress: "warn", completed: "dim", cancelled: "dim", no_show: "bad",
  open: "info", waiting_parts: "warn",
  new: "info", replied: "good", booked: "good", dismissed: "dim",
  queued: "info", sent: "good", failed: "bad", skipped: "dim", published: "good", draft: "dim", partial: "warn",
};
// Default chip text for statuses shown without their own label (leads, social posts and targets).
const CHIP_LABELS = {
  new: N_("New"), replied: N_("Replied"), booked: N_("Booked"), dismissed: N_("Dismissed"),
  queued: N_("Queued"), sent: N_("Sent"), failed: N_("Failed"), skipped: N_("Skipped"), published: N_("Published"),
  draft: N_("Draft"), partial: N_("Partly published"), pending: N_("Pending"), processing: N_("Processing"),
};
export function chip(status, label) {
  return h("span.chip", { class: STATUS_TONE[status] || "" }, label || (CHIP_LABELS[status] ? t(CHIP_LABELS[status]) : String(status).replace(/_/g, " ")));
}

export function plate(reg) { return reg ? h("span.plate", formatReg(reg)) : null; }

// ---------- formatting ----------
/** "AB12CDE" -> "AB12 CDE" for current-style plates; others unchanged. */
export function formatReg(reg) {
  const r = String(reg || "").toUpperCase().replace(/\s/g, "");
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r) ? `${r.slice(0, 4)} ${r.slice(4)}` : r;
}
// Formatters follow the user's language (built on first use, after the language is known).
const fmts = {};
const fmt = (key, opts) => (fmts[`${locale()}|${key}`] ??= new Intl.DateTimeFormat(locale(), opts));
export const fmtDate = iso => (iso ? fmt("date", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : "");
export const fmtTime = iso => (iso ? fmt("time", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "");
export const fmtDateTime = iso => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "");
export const fmtLongDate = d => fmt("long", { weekday: "long", day: "numeric", month: "long" }).format(d);
export const fmtNumber = n => Number(n).toLocaleString(locale());
export const fmtMiles = n => tn(Number(n), "{n} mile|{n} miles", { n: fmtNumber(n) });
export function fmtAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  return fmtDate(iso);
}
export function fmtPhone(e164) {
  if (!e164) return "";
  return e164.startsWith("+44") ? "0" + e164.slice(3).replace(/(\d{4})(\d{3})(\d+)/, "$1 $2 $3") : e164;
}
const SERVICE_EN = {
  remap: N_("ECU remap"), keys: N_("Keys and immobiliser"), coding: N_("Coding"), modules: N_("Module work"),
  diagnostics: N_("Diagnostics"), servicing: N_("Servicing and repairs"), other: N_("Other"),
};
/** Service names in the user's language (looked up on read, so the language can be set after import). */
export const SERVICE_LABELS = new Proxy(SERVICE_EN, { get: (o, k) => (typeof o[k] === "string" ? t(o[k]) : o[k]) });

/** Job titles the Hub writes itself ("Keys and immobiliser · AB12 CDE") are stored in English;
 *  show the service part in the reader's language. Titles people typed are shown as written. */
export function jobTitle(title) {
  const [first, ...rest] = String(title || "").split(" · ");
  return Object.values(SERVICE_EN).includes(first) ? [t(first), ...rest].join(" · ") : title;
}

// ---------- forms ----------
export function field(label, input, hint) {
  return h("label.field", h("span", label), input, hint ? h("small", hint) : null, h("p.err", { hidden: true }));
}

/** Shows server-side field errors next to their inputs (inputs need name="..."). */
export function showFieldErrors(form, err) {
  form.querySelectorAll(".field .err").forEach(e => { e.hidden = true; e.textContent = ""; });
  form.querySelectorAll("[aria-invalid]").forEach(e => e.removeAttribute("aria-invalid"));
  for (const [name, msg] of Object.entries(err?.fields || {})) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    input.setAttribute("aria-invalid", "true");
    const e = input.closest(".field")?.querySelector(".err");
    if (e) { e.textContent = msg; e.hidden = false; }
  }
}

/** Segmented choice. Returns { el, get value() }. */
export function segmented(options, value, onChange) {
  let current = value;
  const el = h("div.seg", { role: "group" });
  for (const [v, label] of options) {
    const b = h("button", { type: "button", "aria-pressed": String(v === current) }, label);
    b.addEventListener("click", () => {
      current = v;
      el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      onChange?.(v);
    });
    el.append(b);
  }
  return { el, get value() { return current; } };
}

// ---------- sheet ----------
/** Opens a sheet (bottom sheet on phones, dialog on desktop). Returns close(). */
export function sheet(title, content, actions = []) {
  const prev = document.activeElement;
  const backdrop = h("div.sheet-backdrop");
  const panel = h("div.sheet", { role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div.sheet-head", h("h2.h2.chrome", title), h("button.btn.small.ghost", { type: "button", onclick: () => close() }, t("Close"))),
    content,
    actions.length ? h("div.sheet-actions", actions) : null,
  );
  function close() { backdrop.remove(); panel.remove(); document.removeEventListener("keydown", onKey); prev?.focus?.(); }
  function onKey(e) { if (e.key === "Escape") close(); }
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop, panel);
  panel.querySelector("input, select, textarea, button:not(.ghost)")?.focus();
  return close;
}

export function pageHead(kicker, title, ...actions) {
  return h("div.page-head", h("div", h("p.kicker", kicker), h("h1.h1.chrome", title)), actions.length ? h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, actions) : null);
}

// ---------- translation of free text ----------
/** Free text written by customers or staff, with a "Translate" button that shows an AI translation
 *  underneath. The original is never changed. `source` is what gets translated when it differs from
 *  what is shown (e.g. a lead's summary plus the comment it came from). */
export function translatable(shown, style = "margin:0;white-space:pre-wrap;overflow-wrap:anywhere", source = shown) {
  const original = h("p", { style }, shown);
  const text = source;
  if (!text || !String(text).trim()) return original;
  const result = h("div", { hidden: true, style: "display:grid;gap:4px;padding:8px 12px;border-left:2px solid var(--line-strong);border-radius:4px;background:var(--raise)" });
  const btn = h("button.btn.small.ghost", { type: "button" }, icon("spark"), t("Translate"));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.replaceChildren(h("span.spinner"), t("Translating…"));
    try {
      const { translation } = await api("/api/ai/translate", { method: "POST", body: { text: String(text).slice(0, 4000) } });
      result.replaceChildren(h("span.muted.small", t("Translation (AI)")), h("p", { style: "margin:0;white-space:pre-wrap;overflow-wrap:anywhere" }, translation));
      result.hidden = false;
      btn.remove();
    } catch (err) {
      toast(err.message, "bad");
      btn.disabled = false;
      btn.replaceChildren(icon("spark"), t("Translate"));
    }
  });
  return h("div.stack", { style: "gap:6px" }, original, h("div", btn), result);
}
