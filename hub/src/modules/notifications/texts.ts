// Notification wording in English and Polish. Phone pushes are rendered on the server (the
// service worker can't translate), and the inbox renders the same keys for whoever is reading.
import type { Lang } from "../../lib/env";

export const NOTIFY_KINDS = [
  "booking_new", "booking_confirmed", "booking_rescheduled", "booking_cancelled",
  "job_new", "job_assigned", "job_started", "job_completed", "job_cancelled", "job_note",
  "lead_new", "social_failed", "test",
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Settings switches: each groups one or more kinds. "test" can't be switched off. */
export const PREF_GROUPS = ["bookings_new", "bookings_changes", "jobs_new", "jobs_assigned", "jobs_status", "jobs_notes", "leads", "social"] as const;
export type PrefGroup = (typeof PREF_GROUPS)[number];

export const GROUP_OF: Record<NotifyKind, PrefGroup | null> = {
  booking_new: "bookings_new", booking_confirmed: "bookings_changes", booking_rescheduled: "bookings_changes", booking_cancelled: "bookings_changes",
  job_new: "jobs_new", job_assigned: "jobs_assigned", job_started: "jobs_status", job_completed: "jobs_status", job_cancelled: "jobs_status",
  job_note: "jobs_notes", lead_new: "leads", social_failed: "social", test: null,
};

type Texts = Record<string, string>;

const EN: Texts = {
  "booking_new.title": "New booking {ref}",
  "booking_new.body": "{name} · {service}{reg}",
  "booking_confirmed.title": "Booking {ref} confirmed",
  "booking_confirmed.body": "{name} · {when}",
  "booking_rescheduled.title": "Booking {ref} moved",
  "booking_rescheduled.body": "{name} · now {when}",
  "booking_cancelled.title": "Booking {ref} cancelled",
  "booking_cancelled.body": "{name} · {service}{reg}",
  "job_new.title": "New job {ref}",
  "job_new.body": "{title} · added by {actor}",
  "job_assigned.title": "Job {ref} is yours",
  "job_assigned.body": "{actor} assigned you: {title}",
  "job_started.title": "Job {ref} started",
  "job_started.body": "{title} · {actor}",
  "job_completed.title": "Job {ref} completed",
  "job_completed.body": "{title} · {actor}",
  "job_cancelled.title": "Job {ref} cancelled",
  "job_cancelled.body": "{title} · {actor}",
  "job_note.title": "Note on job {ref}",
  "job_note.body": "{actor}: {note}",
  "lead_new.title": "New lead on {platform}",
  "lead_new.body": "@{handle}: {summary}",
  "social_failed.title": "A post didn't publish",
  "social_failed.body": "{platform}: {error}",
  "test.title": "Curve Hub notifications are on",
  "test.body": "This is a test. You'll be told here about bookings, jobs and leads.",
  // fallbacks for params
  "someone": "someone",
  "website": "website",
};

const PL: Texts = {
  "booking_new.title": "Nowa rezerwacja {ref}",
  "booking_new.body": "{name} · {service}{reg}",
  "booking_confirmed.title": "Rezerwacja {ref} potwierdzona",
  "booking_confirmed.body": "{name} · {when}",
  "booking_rescheduled.title": "Rezerwacja {ref} przeniesiona",
  "booking_rescheduled.body": "{name} · teraz {when}",
  "booking_cancelled.title": "Rezerwacja {ref} anulowana",
  "booking_cancelled.body": "{name} · {service}{reg}",
  "job_new.title": "Nowe zlecenie {ref}",
  "job_new.body": "{title} · dodał(a) {actor}",
  "job_assigned.title": "Zlecenie {ref} jest Twoje",
  "job_assigned.body": "{actor} przypisał(a) Ci: {title}",
  "job_started.title": "Zlecenie {ref} rozpoczęte",
  "job_started.body": "{title} · {actor}",
  "job_completed.title": "Zlecenie {ref} zakończone",
  "job_completed.body": "{title} · {actor}",
  "job_cancelled.title": "Zlecenie {ref} anulowane",
  "job_cancelled.body": "{title} · {actor}",
  "job_note.title": "Notatka w zleceniu {ref}",
  "job_note.body": "{actor}: {note}",
  "lead_new.title": "Nowe zapytanie na {platform}",
  "lead_new.body": "@{handle}: {summary}",
  "social_failed.title": "Post nie został opublikowany",
  "social_failed.body": "{platform}: {error}",
  "test.title": "Powiadomienia Curve Hub są włączone",
  "test.body": "To jest test. Tutaj dostaniesz informacje o rezerwacjach, zleceniach i zapytaniach.",
  "someone": "ktoś",
  "website": "strona internetowa",
};

export const TEXTS: Record<Lang, Texts> = { en: EN, pl: PL };

// Service names inside job titles and booking params (titles the Hub writes are stored in English).
const SERVICES: Record<string, { en: string; pl: string }> = {
  remap: { en: "ECU remap", pl: "Remap ECU" },
  keys: { en: "Keys and immobiliser", pl: "Klucze i immobilizer" },
  coding: { en: "Coding", pl: "Kodowanie" },
  modules: { en: "Module work", pl: "Moduły" },
  diagnostics: { en: "Diagnostics", pl: "Diagnostyka" },
  servicing: { en: "Servicing and repairs", pl: "Serwis i naprawy" },
  other: { en: "Other", pl: "Inne" },
};
const PLATFORMS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", google: "YouTube" };

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : ""));

function localiseTitle(title: string, lang: Lang): string {
  const [first, ...rest] = title.split(" · ");
  const svc = Object.values(SERVICES).find(s => s.en === first);
  return svc ? [svc[lang], ...rest].join(" · ") : title;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Title and body for one notification in one language. Params are plain strings saved with the notification. */
export function renderNotification(titleKey: string, bodyKey: string, params: Record<string, string>, lang: Lang): { title: string; body: string } {
  const T = TEXTS[lang];
  const v: Record<string, string> = { ...params };
  if (params.service) v.service = SERVICES[params.service]?.[lang] ?? params.service;
  v.reg = params.reg ? ` · ${params.reg}` : "";
  if (params.title) v.title = clip(localiseTitle(params.title, lang), 90);
  if (params.platform) v.platform = PLATFORMS[params.platform] ?? params.platform;
  if (!params.actor) v.actor = T.someone;
  if (params.note) v.note = clip(params.note.replace(/\s+/g, " "), 140);
  if (params.summary) v.summary = clip(params.summary, 140);
  if (params.start) {
    v.when = new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
    }).format(new Date(params.start));
  }
  return { title: fill(T[titleKey] ?? EN[titleKey] ?? titleKey, v).trim(), body: fill(T[bodyKey] ?? EN[bodyKey] ?? "", v).trim() };
}
