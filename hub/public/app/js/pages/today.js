// Today: what needs attention right now.
import { api, fmtLongDate, h, pageHead, t } from "../core.js";

export async function render(view, { refreshCounts }) {
  const { counts, user } = await api("/api/system/overview");
  refreshCounts();
  const first = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("Morning, {name}", { name: first }) : hour < 18 ? t("Afternoon, {name}", { name: first }) : t("Evening, {name}", { name: first });
  const stat = (n, label, href, hot) => h("a.stat", { href, class: hot && n ? "hot" : "" }, h("strong", String(n)), h("span", label));
  view.replaceChildren(
    pageHead(fmtLongDate(new Date()), greeting),
    h("div.stats",
      stat(counts.requested, t("Booking requests to confirm"), "#/bookings", true),
      stat(counts.today, t("Cars booked in today"), "#/bookings"),
      stat(counts.openJobs, t("Open jobs"), "#/jobs"),
      stat(counts.newLeads, t("New leads from comments"), "#/leads", true),
    ),
  );
}
