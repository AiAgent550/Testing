// Calendar: the week (always opening on this week) or the month, with jobs booked in, bookings that have no job
// yet, days off and day notes. Tap a day's + to add a job, schedule an existing one, book a day off or pin a note.
// Tap a job to move it, set its flags ("Parts ordered", "Customer informed") or add a note.
import { api, chip, field, h, icon, jobTitle, loading, pageHead, plate, segmented, sheet, showFieldErrors, t, toast } from "../core.js";
import { FLAGS, addDays, dayLong, flagLabel, flagToggles, fmt, isoDay, mondayOf, parseDay, scheduleFields, todayIso } from "../schedule.js";

const STATUS = { open: t("Open"), in_progress: t("In progress"), waiting_parts: t("Waiting for parts"), completed: t("Completed"), cancelled: t("Cancelled") };
const TONE = { open: "info", in_progress: "warn", waiting_parts: "warn", completed: "dim", cancelled: "dim" };
let mode = (() => { try { return localStorage.getItem("cal-mode") === "month" ? "month" : "week"; } catch { return "week"; } })();
let anchor = null; // a day inside the shown week or month; reset to today when the page is opened fresh

export async function render(view, { params, navigate }) {
  if (params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0])) anchor = params[0];
  anchor = anchor || todayIso();
  const body = h("div");
  const rangeLabel = h("span.cal-range");
  const modeSeg = segmented([["week", t("Week")], ["month", t("Month")]], mode, v => { mode = v; try { localStorage.setItem("cal-mode", v); } catch {} load(); });
  const step = dir => { anchor = mode === "week" ? addDays(anchor, 7 * dir) : shiftMonth(anchor, dir); load(); };
  view.replaceChildren(
    pageHead(t("Workshop"), t("Calendar"), h("button.btn.primary", { type: "button", onclick: () => addSheet(todayIso(), load) }, icon("plus"), t("Add"))),
    h("div.cal-bar",
      h("div.cal-nav",
        h("button.btn.small", { type: "button", "aria-label": t("Previous"), onclick: () => step(-1) }, "‹"),
        h("button.btn.small", { type: "button", onclick: () => { anchor = todayIso(); load(); } }, t("Today")),
        h("button.btn.small", { type: "button", "aria-label": t("Next"), onclick: () => step(1) }, "›"),
        rangeLabel),
      modeSeg.el),
    body);

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const { from, to } = mode === "week" ? { from: mondayOf(anchor), to: addDays(mondayOf(anchor), 6) } : monthRange(anchor);
    rangeLabel.textContent = mode === "week" ? weekLabel(from, to) : fmt(anchor, { month: "long", year: "numeric" });
    body.replaceChildren(loading());
    try {
      const data = await api(`/api/calendar?from=${from}&to=${to}`);
      if (mine !== seq) return;
      const days = index(data, from, to);
      body.replaceChildren(mode === "week" ? weekView(days, data, load, navigate) : monthView(days, data, load, navigate, anchor));
    } catch (err) { if (mine === seq) body.replaceChildren(h("p.hint", err.message)); }
  }
  load();
}

// ---------- ranges ----------
function shiftMonth(s, dir) { const d = parseDay(s); d.setDate(1); d.setMonth(d.getMonth() + dir); return isoDay(d); }
function monthRange(s) {
  const d = parseDay(s);
  const first = isoDay(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const last = isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6), first, last };
}
function weekLabel(from, to) {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${fmt(from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Groups everything by day. */
function index(data, from, to) {
  const days = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { day: d, off: [], notes: [], jobs: [], bookings: [] });
  for (const e of data.entries) for (let d = e.start_date < from ? from : e.start_date; d <= e.end_date && d <= to; d = addDays(d, 1)) days.get(d)?.[e.kind === "off" ? "off" : "notes"].push(e);
  for (const j of data.jobs) {
    const end = addDays(j.scheduled_date, (j.duration_days || 1) - 1);
    let n = 1;
    for (let d = j.scheduled_date; d <= end; d = addDays(d, 1), n++) if (d >= from && d <= to) days.get(d)?.jobs.push({ ...j, dayN: n });
  }
  for (const b of data.bookings) days.get(b.day)?.bookings.push(b);
  return [...days.values()];
}

// ---------- week ----------
function weekView(days, data, reload, navigate) {
  const today = todayIso();
  return h("div.cal-week", days.map(d => {
    const items = dayItems(d, data, reload, navigate);
    return h("section.cal-day", { class: [d.day === today ? "today" : "", d.day < today ? "past" : "", d.off.some(o => !o.user_id) ? "off" : ""].filter(Boolean).join(" ") },
      h("div.cal-day-head",
        h("b", h("small", fmt(d.day, { weekday: "short" })), fmt(d.day, { day: "numeric", month: "short" })),
        h("button.cal-add", { type: "button", "aria-label": t("Add to {day}", { day: dayLong(d.day) }), onclick: () => addSheet(d.day, reload) }, icon("plus"))),
      items.length ? items : h("p.cal-empty", t("Nothing booked")));
  }));
}

function dayItems(d, data, reload, navigate) {
  return [
    ...d.off.map(e => h("button.cal-item.off", { type: "button", onclick: () => entrySheet(e, data.users, reload) },
      h("span.t", e.user_name ? t("{name} off", { name: e.user_name.split(" ")[0] }) : t("Closed")), e.title && e.title !== "Day off" ? h("span.s", e.title) : null)),
    ...d.notes.map(e => h("button.cal-item.note", { type: "button", onclick: () => entrySheet(e, data.users, reload) }, h("span.t", e.title))),
    ...d.jobs.map(j => h("button.cal-item", { type: "button", class: `st-${j.status}`, onclick: () => jobSheet(j, reload, navigate) },
      h("span.t", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, j.reg ? plate(j.reg) : null, jobTitle(j.title)),
      h("span.s", [j.scheduled_time, j.customer_name, j.duration_days > 1 ? t("day {n} of {total}", { n: j.dayN, total: j.duration_days }) : null, STATUS[j.status]].filter(Boolean).join(" · ")),
      j.flags.length ? h("span.cal-flags", j.flags.map(f => h("span.cal-flag", { class: f }, flagLabel(f)))) : null)),
    ...d.bookings.map(b => h("a.cal-item.booking", { href: `#/bookings/${encodeURIComponent(b.id)}` },
      h("span.t", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, b.reg ? plate(b.reg) : null, `${t("Booking")} ${b.ref}`),
      h("span.s", [b.customer_name, b.confirmed ? t("Confirmed, no job card yet") : t("Asked for this day")].filter(Boolean).join(" · ")))),
  ];
}

// ---------- month ----------
function monthView(days, data, reload, navigate, anchorDay) {
  const today = todayIso(), month = anchorDay.slice(0, 7);
  const dows = days.slice(0, 7).map(d => h("div.dow", fmt(d.day, { weekday: "short" })));
  return h("div.cal-month", dows, days.map(d => {
    const lines = [
      ...d.off.map(e => h("span.m.off", e.user_name ? t("{name} off", { name: e.user_name.split(" ")[0] }) : t("Closed"))),
      ...d.jobs.map(j => h("span.m", { class: `st-${j.status}` }, j.reg ? j.reg : jobTitle(j.title))),
      ...d.bookings.map(b => h("span.m.booking", b.reg || b.ref)),
      ...d.notes.map(e => h("span.m", e.title)),
    ];
    return h("button.cal-cell", { type: "button", class: [d.day.slice(0, 7) !== month ? "other" : "", d.day === today ? "today" : "", d.off.some(o => !o.user_id) ? "off" : ""].filter(Boolean).join(" "),
      "aria-label": dayLong(d.day), onclick: () => daySheet(d, data, reload, navigate) },
      h("span.n", String(parseDay(d.day).getDate())), lines.slice(0, 3), lines.length > 3 ? h("span.more", t("+{n} more", { n: lines.length - 3 })) : null);
  }));
}

function daySheet(d, data, reload, navigate) {
  const items = dayItems(d, data, () => { close(); reload(); }, navigate);
  const close = sheet(dayLong(d.day),
    h("div.stack", { style: "gap:8px" }, items.length ? items : h("p.cal-empty", t("Nothing booked"))),
    [h("button.btn", { type: "button", onclick: () => { close(); anchorTo(d.day); } }, t("Open week")),
     h("button.btn.primary", { type: "button", onclick: () => { close(); addSheet(d.day, reload); } }, icon("plus"), t("Add"))]);
}
function anchorTo(day) { anchor = day; mode = "week"; try { localStorage.setItem("cal-mode", "week"); } catch {} location.hash = `#/calendar/${day}`; }

// ---------- a job ----------
function jobSheet(j, reload, navigate) {
  const job = { ...j, flags: [...j.flags] };
  const sched = scheduleFields(job);
  const noteInput = h("textarea.input", { rows: 2, maxlength: 4000, placeholder: t("e.g. Customer will drop the car off at 9") });
  let changed = false;
  const save = h("button.btn.primary", { type: "button", onclick: async () => {
    save.disabled = true;
    try {
      const v = sched.value();
      await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: v });
      if (noteInput.value.trim()) await api(`/api/jobs/${encodeURIComponent(job.id)}/notes`, { method: "POST", body: { body: noteInput.value } });
      close(); toast(v.scheduled_date !== j.scheduled_date ? t("Moved to {day}.", { day: dayLong(v.scheduled_date) }) : t("Saved.")); reload();
    } catch (err) { toast(err.message, "bad"); save.disabled = false; }
  } }, t("Save"));
  const unschedule = h("button.btn.ghost", { type: "button", onclick: async () => {
    if (!confirm(t("Take this job off the calendar? It stays in Jobs."))) return;
    try { await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: { scheduled_date: null } }); close(); toast(t("Taken off the calendar.")); reload(); }
    catch (err) { toast(err.message, "bad"); }
  } }, t("Unschedule"));
  const close = sheet(`${job.ref}${job.reg ? ` · ${job.reg}` : ""}`,
    h("div.stack", { style: "gap:16px" },
      h("div.stack", { style: "gap:6px" },
        h("strong", jobTitle(job.title)),
        h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, chip(TONE[job.status], STATUS[job.status]), job.customer_name ? h("span.muted.small", job.customer_name) : null),
        job.last_note ? h("p.muted.small", { style: "margin:0" }, t("Last note: {note}", { note: job.last_note })) : null),
      h("div.stack", { style: "gap:8px" }, h("span.muted.small", t("Quick updates")), flagToggles(job, () => { changed = true; })),
      h("div.stack", { style: "gap:8px" }, h("span.muted.small", t("Move")), sched.el),
      field(t("Add a note"), noteInput),
      h("a.btn", { href: `#/jobs/${encodeURIComponent(job.id)}` }, t("Open job card"))),
    [unschedule, save]);
  // Flags save on tap; redraw the calendar when the sheet closes so the badges update.
  const obs = new MutationObserver(() => { if (!document.body.contains(save)) { obs.disconnect(); if (changed) reload(); } });
  obs.observe(document.body, { childList: true });
}

// ---------- add to a day ----------
function addSheet(day, reload) {
  let what = "job";
  const box = h("div.stack", { style: "gap:14px" });
  const seg = segmented([["job", t("New job")], ["existing", t("Existing job")], ["off", t("Day off")], ["note", t("Note")]], what, v => { what = v; draw(); });
  const dayInput = h("input.input", { type: "date", value: day });
  const actions = h("button.btn.primary", { type: "submit", form: "cal-add" }, t("Add"));
  const form = h("form.form", { id: "cal-add", novalidate: true }, seg.el, field(t("Day"), dayInput), box);
  const close = sheet(t("Add to the calendar"), form, [actions]);
  let fields = {};

  async function draw() {
    actions.hidden = what === "existing";
    if (what === "job") {
      fields = {
        title: h("input.input", { name: "title", maxlength: 200, placeholder: t("e.g. Spare key, ELV fault, Stage 1") }),
        reg: h("input.input.reg", { name: "reg", maxlength: 10, autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "AB12 CDE" }),
        time: h("input.input", { name: "scheduled_time", type: "time", step: 900 }),
        days: h("select.input", { name: "duration_days" }, [1, 2, 3, 4, 5, 7, 10, 14].map(n => h("option", { value: n }, n === 1 ? t("1 day") : t("{n} days", { n })))),
        description: h("textarea.input", { name: "description", rows: 3, maxlength: 4000, placeholder: t("What the customer said, symptoms, fault codes") }),
      };
      box.replaceChildren(field(t("What's the job?"), fields.title), field(t("Registration"), fields.reg),
        h("div.form-row", field(t("Time (optional)"), fields.time), field(t("How long"), fields.days)), field(t("Issue"), fields.description));
    } else if (what === "existing") {
      box.replaceChildren(loading());
      try {
        const { jobs } = await api("/api/jobs?status=active&unscheduled=1");
        box.replaceChildren(jobs.length
          ? h("div.list", jobs.map(j => h("button.row", { type: "button", onclick: async () => {
            try {
              await api(`/api/jobs/${encodeURIComponent(j.id)}`, { method: "PATCH", body: { scheduled_date: dayInput.value || day } });
              close(); toast(t("{ref} booked in for {day}.", { ref: j.ref, day: dayLong(dayInput.value || day) })); reload();
            } catch (err) { toast(err.message, "bad"); }
          } },
            h("span.title", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, j.reg ? plate(j.reg) : null, jobTitle(j.title)),
            chip(TONE[j.status], STATUS[j.status]),
            h("span.sub", [j.ref, j.customer_name].filter(Boolean).join(" · ")))))
          : h("p.cal-empty", t("Every open job is already on the calendar.")));
      } catch (err) { box.replaceChildren(h("p.hint", err.message)); }
    } else if (what === "off") {
      const { users } = await api("/api/users").catch(() => ({ users: [] }));
      fields = {
        who: h("select.input", { name: "user_id" }, h("option", { value: "" }, t("Everyone (closed)")), users.map(u => h("option", { value: u.id }, u.name))),
        end: h("input.input", { name: "end_date", type: "date", value: dayInput.value }),
        title: h("input.input", { name: "title", maxlength: 200, placeholder: t("e.g. Holiday") }),
      };
      box.replaceChildren(field(t("Who's off"), fields.who), field(t("Last day off"), fields.end), field(t("Reason (optional)"), fields.title));
    } else {
      fields = {
        title: h("input.input", { name: "title", maxlength: 200, placeholder: t("e.g. Parts delivery from Network Auto") }),
        end: h("input.input", { name: "end_date", type: "date", value: dayInput.value }),
      };
      box.replaceChildren(field(t("Note"), fields.title), field(t("Until (optional)"), fields.end));
    }
  }
  dayInput.addEventListener("change", () => { if (fields.end && fields.end.value < dayInput.value) fields.end.value = dayInput.value; });
  draw();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    showFieldErrors(form, null);
    const start = dayInput.value || day;
    actions.disabled = true;
    try {
      if (what === "job") {
        if (!fields.title.value.trim()) { showFieldErrors(form, { fields: { title: t("Required.") } }); actions.disabled = false; return; }
        const { job } = await api("/api/jobs", { method: "POST", body: {
          title: fields.title.value, reg: fields.reg.value || undefined, description: fields.description.value || undefined,
          scheduled_date: start, scheduled_time: fields.time.value || undefined, duration_days: Number(fields.days.value),
        } });
        toast(t("{ref} booked in for {day}.", { ref: job.ref, day: dayLong(start) }));
      } else {
        if (what === "note" && !fields.title.value.trim()) { showFieldErrors(form, { fields: { title: t("Required.") } }); actions.disabled = false; return; }
        await api("/api/calendar/entries", { method: "POST", body: {
          kind: what === "off" ? "off" : "note", start_date: start, end_date: fields.end.value || start,
          title: fields.title.value.trim() || undefined, user_id: what === "off" ? fields.who.value || null : null,
        } });
        toast(what === "off" ? t("Day off added.") : t("Note added."));
      }
      close(); reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); actions.disabled = false; }
  });
}

// ---------- a day off or note ----------
function entrySheet(e, users, reload) {
  const title = h("input.input", { name: "title", maxlength: 200, value: e.title });
  const start = h("input.input", { name: "start_date", type: "date", value: e.start_date });
  const end = h("input.input", { name: "end_date", type: "date", value: e.end_date });
  const who = e.kind === "off" ? h("select.input", { name: "user_id" }, h("option", { value: "" }, t("Everyone (closed)")), users.map(u => h("option", { value: u.id, selected: u.id === e.user_id }, u.name))) : null;
  const form = h("form.form", { id: "cal-entry", novalidate: true },
    who ? field(t("Who's off"), who) : null,
    field(e.kind === "off" ? t("Reason (optional)") : t("Note"), title),
    h("div.form-row", field(t("From"), start), field(t("Until"), end)));
  const del = h("button.btn.danger", { type: "button", onclick: async () => {
    if (!confirm(e.kind === "off" ? t("Remove this day off?") : t("Delete this note?"))) return;
    try { await api(`/api/calendar/entries/${encodeURIComponent(e.id)}`, { method: "DELETE" }); close(); toast(t("Removed.")); reload(); }
    catch (err) { toast(err.message, "bad"); }
  } }, t("Delete"));
  const save = h("button.btn.primary", { type: "submit", form: "cal-entry" }, t("Save"));
  const close = sheet(e.kind === "off" ? t("Day off") : t("Note"), form, [del, save]);
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    try {
      await api(`/api/calendar/entries/${encodeURIComponent(e.id)}`, { method: "PATCH", body: {
        title: title.value.trim() || (e.kind === "off" ? "Day off" : e.title), start_date: start.value, end_date: end.value, ...(who ? { user_id: who.value || null } : {}),
      } });
      close(); toast(t("Saved.")); reload();
    } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); }
  });
}

// Listed so they get Polish entries.
void FLAGS;
