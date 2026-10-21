// Page registry: the only place that lists the dashboard's sections.
// `tab: true` puts a section in the phone tab bar (max 4 plus "More").
export const PAGES = [
  { id: "today",     label: "Today",     icon: "today",     tab: true,  load: () => import("./today.js") },
  { id: "bookings",  label: "Bookings",  icon: "bookings",  tab: true,  load: () => import("./bookings.js") },
  { id: "jobs",      label: "Jobs",      icon: "jobs",      tab: true,  load: () => import("./jobs.js") },
  { id: "leads",     label: "Leads",     icon: "leads",     tab: true,  load: () => import("./leads.js"), badge: "newLeads" },
  { id: "customers", label: "Customers", icon: "customers", tab: false, load: () => import("./customers.js") },
  { id: "social",    label: "Social",    icon: "social",    tab: false, load: () => import("./social.js") },
  { id: "settings",  label: "Settings",  icon: "settings",  tab: false, load: () => import("./settings.js") },
];
