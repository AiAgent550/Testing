// Dashboard shell: navigation, hash routing (#/page/arg), and handing the view to page modules.
// Each page module exports `render(view, { params, navigate })` and may return a cleanup function.
import { PAGES } from "./pages/index.js";
import { api, h, icon, loading, toast } from "./core.js";

const view = document.getElementById("view");
let cleanup = null, counts = {};

function navItems(compact) {
  const items = compact ? PAGES.filter(p => p.tab) : PAGES;
  const out = items.map(p => h("a.nav-item", { href: `#/${p.id}`, dataset: { page: p.id } },
    icon(p.icon), h("span", p.label), p.badge && counts[p.badge] ? h("span.badge", String(counts[p.badge])) : null));
  if (compact) out.push(h("a.nav-item", { href: "#/more", dataset: { page: "more" } }, icon("more"), h("span", "More")));
  return out;
}

function drawNav() {
  const rail = document.getElementById("rail"), tabbar = document.getElementById("tabbar");
  const brand = document.querySelector(".topbar .brand").cloneNode(true);
  rail.replaceChildren(brand, ...navItems(false), h("div.grow"),
    h("button.nav-item", { type: "button", onclick: signOut, style: "border:0;background:none;cursor:pointer" }, icon("logout"), h("span", "Sign out")));
  tabbar.replaceChildren(...navItems(true));
  markCurrent();
}

function markCurrent() {
  const id = (location.hash.slice(2).split("/")[0]) || "today";
  const inTabs = PAGES.some(p => p.tab && p.id === id);
  const set = (a, on) => (on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.querySelectorAll("#rail .nav-item[data-page]").forEach(a => set(a, a.dataset.page === id));
  document.querySelectorAll("#tabbar .nav-item[data-page]").forEach(a => set(a, a.dataset.page === id || (a.dataset.page === "more" && !inTabs)));
}

async function signOut() {
  try { await api("/api/auth/logout", { method: "POST" }); } finally { location.href = "/login"; }
}

function renderMore() {
  view.replaceChildren(
    h("div.page-head", h("div", h("p.kicker", "Curve Hub"), h("h1.h1.chrome", "More"))),
    h("div.list", PAGES.filter(p => !p.tab).map(p => h("a.row", { href: `#/${p.id}` }, h("span.title", p.label), icon("back", "flip")))),
    h("div", { style: "margin-top:20px" }, h("button.btn", { type: "button", onclick: signOut }, icon("logout"), "Sign out")),
  );
}

async function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const [id = "today", ...params] = location.hash.slice(2).split("/").filter(Boolean);
  markCurrent();
  window.scrollTo(0, 0);
  if (id === "more") return renderMore();
  const page = PAGES.find(p => p.id === id);
  if (!page) { location.hash = "#/today"; return; }
  document.title = `${page.label} · Curve Hub`;
  view.replaceChildren(loading());
  try {
    const mod = await page.load();
    const result = await mod.render(view, { params, navigate: to => (location.hash = to), refreshCounts });
    if (typeof result === "function") cleanup = result;
  } catch (err) {
    console.error(err);
    view.replaceChildren(h("div.empty", h("p", { style: "margin:0" }, err.message || "This page couldn't load.")));
  }
  view.focus({ preventScroll: true });
}

async function refreshCounts() {
  try { counts = (await api("/api/system/overview")).counts; drawNav(); } catch {}
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    document.getElementById("who").textContent = me.user.name;
  } catch { return; }
  drawNav();
  refreshCounts();
  addEventListener("hashchange", route);
  route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  addEventListener("unhandledrejection", e => { if (e.reason?.message) toast(e.reason.message, "bad"); });
}

boot();
