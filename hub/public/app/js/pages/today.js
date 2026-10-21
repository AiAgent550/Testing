// Today: what needs attention right now.
import { api, h, pageHead } from "../core.js";

export async function render(view, { refreshCounts }) {
  const { counts, user } = await api("/api/system/overview");
  refreshCounts();
  const first = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const stat = (n, label, href, hot) => h("a.stat", { href, class: hot && n ? "hot" : "" }, h("strong", String(n)), h("span", label));
  view.replaceChildren(
    pageHead(new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()), `${greeting}, ${first}`),
    h("div.stats",
      stat(counts.requested, "Booking requests to confirm", "#/bookings", true),
      stat(counts.today, "Cars booked in today", "#/bookings"),
      stat(counts.openJobs, "Open jobs", "#/jobs"),
      stat(counts.newLeads, "New leads from comments", "#/leads", true),
    ),
  );
}
