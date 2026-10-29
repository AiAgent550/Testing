// Notifications: what happened while you were away (bookings, jobs, notes, leads), newest first.
import { api, empty, fmtAgo, h, pageHead, t, toast } from "../core.js";

export async function render(view, { refreshBell }) {
  const listBox = h("div");
  const allBtn = h("button.btn.small", { type: "button" }, t("Mark all as read"));

  async function load() {
    const { notifications, unread } = await api("/api/notifications?limit=50");
    allBtn.disabled = !unread;
    if (!notifications.length) {
      listBox.replaceChildren(empty(t("Nothing yet. New bookings, jobs, notes and leads will show up here."), "bell", h("a.btn.small", { href: "#/settings" }, t("Notification settings"))));
      return;
    }
    listBox.replaceChildren(h("div.list", notifications.map(n => {
      const row = h("a.row.notif", { href: n.link || "#/today", class: n.read_at ? "" : "unread" },
        h("span.title", n.title),
        h("span.muted.small", { style: "white-space:nowrap" }, fmtAgo(n.created_at)),
        n.body ? h("span.sub", n.body) : null,
      );
      if (!n.read_at) row.addEventListener("click", () => {
        api("/api/notifications/read", { method: "POST", body: { ids: [n.id] } }).then(() => refreshBell?.()).catch(() => {});
      });
      return row;
    })));
  }

  allBtn.addEventListener("click", async () => {
    try { await api("/api/notifications/read", { method: "POST", body: { all: true } }); await load(); refreshBell?.(); }
    catch (err) { toast(err.message, "bad"); }
  });

  view.replaceChildren(pageHead("Curve Hub", t("Notifications"), allBtn), listBox,
    h("p.muted.small", { style: "margin:18px 0 0" }, h("a", { href: "#/settings" }, t("Notification settings"))));
  await load();
  const onMsg = e => { if (e.data?.type === "notification") load().catch(() => {}); };
  navigator.serviceWorker?.addEventListener("message", onMsg);
  return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
}
