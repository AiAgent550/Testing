// Page registry: the only place that lists the dashboard's sections.
// `tab: true` puts a section in the phone tab bar (max 4 plus "More"). Labels are translated where shown.
import { N_ } from "/assets/i18n.js";

export const PAGES = [
  { id: "today",     label: N_("Today"),     icon: "today",     tab: true,  load: () => import("./today.js") },
  { id: "bookings",  label: N_("Bookings"),  icon: "bookings",  tab: true,  load: () => import("./bookings.js") },
  { id: "jobs",      label: N_("Jobs"),      icon: "jobs",      tab: true,  load: () => import("./jobs.js") },
  { id: "leads",     label: N_("Leads"),     icon: "leads",     tab: true,  load: () => import("./leads.js"), badge: "newLeads" },
  { id: "customers", label: N_("Customers"), icon: "customers", tab: false, load: () => import("./customers.js") },
  { id: "social",    label: N_("Social"),    icon: "social",    tab: false, load: () => import("./social.js") },
  { id: "settings",  label: N_("Settings"),  icon: "settings",  tab: false, load: () => import("./settings.js") },
];
