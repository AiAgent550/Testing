// Booking a job onto the calendar and its quick status flags. Shared by the calendar page and the job page.
import { N_, api, field, h, locale, t, toast } from "./core.js";

export const FLAGS = ["parts_ordered", "parts_in", "customer_informed", "waiting_customer", "ready_collect"];
const FLAG_EN = {
  parts_ordered: N_("Parts ordered"), parts_in: N_("Parts arrived"), customer_informed: N_("Customer informed"),
  waiting_customer: N_("Waiting on the customer"), ready_collect: N_("Ready to collect"),
};
export const flagLabel = f => t(FLAG_EN[f] || f);
/** Notes the server writes when a flag is switched on; shown in the reader's language. */
export const FLAG_NOTE_TEXTS = new Set(Object.values(FLAG_EN).concat(["Taken off the calendar"]));
N_("Taken off the calendar");
/** "Rescheduled to 18 Nov 2026" / "Booked in for ..." notes, translated with the date kept. */
export function scheduleNoteText(body) {
  if (FLAG_NOTE_TEXTS.has(body)) return t(body);
  const m = /^(Rescheduled to|Booked in for) (.+)$/.exec(body || "");
  if (m) return m[1] === "Rescheduled to" ? t("Rescheduled to {date}", { date: m[2] }) : t("Booked in for {date}", { date: m[2] });
  return null;
}

// ---------- dates (local calendar days as YYYY-MM-DD) ----------
const pad = n => String(n).padStart(2, "0");
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
export const todayIso = () => isoDay(new Date());
/** Monday of the week containing the day. */
export const mondayOf = s => { const d = parseDay(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDay(d); };
export const fmt = (s, opts) => new Intl.DateTimeFormat(locale(), opts).format(parseDay(s));
export const dayLong = s => fmt(s, { weekday: "long", day: "numeric", month: "long" });

/** Toggle buttons for the flags; saves each tap straight away. */
export function flagToggles(job, onSaved) {
  const box = h("div.flag-toggles");
  const draw = () => box.replaceChildren(FLAGS.map(f => {
    const on = job.flags.includes(f);
    return h("button", { type: "button", "aria-pressed": String(on), onclick: async e => {
      const btn = e.currentTarget; btn.disabled = true;
      const next = on ? job.flags.filter(x => x !== f) : [...job.flags, f];
      try {
        await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: { flags: next } });
        job.flags = FLAGS.filter(x => next.includes(x));
        draw();
        toast(on ? t("{flag}: cleared.", { flag: flagLabel(f) }) : t("{flag}: noted.", { flag: flagLabel(f) }));
        onSaved?.();
      } catch (err) { toast(err.message, "bad"); btn.disabled = false; }
    } }, flagLabel(f));
  }));
  draw();
  return box;
}

/** Day / time / length editor with quick moves. Calls save({scheduled_date, scheduled_time, duration_days}). */
export function scheduleFields(job) {
  const date = h("input.input", { type: "date", value: job.scheduled_date || "" });
  const time = h("input.input", { type: "time", value: job.scheduled_time || "", step: 900 });
  const days = h("select.input", {}, [1, 2, 3, 4, 5, 7, 10, 14].map(n => h("option", { value: n, selected: n === (job.duration_days || 1) }, n === 1 ? t("1 day") : t("{n} days", { n }))));
  const move = n => { date.value = addDays(date.value || todayIso(), n); };
  const quick = h("div", { style: "display:flex;flex-wrap:wrap;gap:8px" },
    h("button.btn.small", { type: "button", onclick: () => move(1) }, t("+1 day")),
    h("button.btn.small", { type: "button", onclick: () => move(7) }, t("+1 week")),
    h("button.btn.small", { type: "button", onclick: () => { date.value = todayIso(); } }, t("Today")));
  return {
    el: h("div.stack", { style: "gap:10px" },
      h("div.form-row", field(t("Day"), date), field(t("Time (optional)"), time)),
      field(t("How long"), days), quick),
    value: () => ({ scheduled_date: date.value || null, scheduled_time: date.value && time.value ? time.value : null, duration_days: Number(days.value) || 1 }),
  };
}
