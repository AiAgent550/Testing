// Jobs: the workshop's job cards. Built for a phone in the workshop first:
// big targets, the plate up top, status as large buttons, camera upload and "Ask AI".
import {
  api, chip, empty, field, fmtAgo, fmtPhone, formatReg, h, icon, loading, pageHead, plate, segmented, sheet, showFieldErrors, t, toast, translatable, N_, jobTitle,
} from "../core.js";

const STATUS_LABELS = { open: t("Open"), in_progress: t("In progress"), waiting_parts: t("Waiting for parts"), completed: t("Completed"), cancelled: t("Cancelled") };
const MOVED = {
  open: t("Job moved back to open."), in_progress: t("Job in progress."), waiting_parts: t("Job waiting for parts."),
  completed: t("Job completed."), cancelled: t("Job cancelled."),
};
const CONFIDENCE = { high: t("High confidence"), medium: t("Medium confidence"), low: t("Low confidence") };
const NEXT = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_parts", "completed", "open"],
  waiting_parts: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: [],
};
const ACTION_LABELS = {
  in_progress: from => (from === "open" ? t("Start work") : from === "completed" ? t("Reopen job") : t("Back to work")),
  waiting_parts: () => t("Waiting for parts"),
  completed: () => t("Mark complete"),
  open: () => t("Back to open"),
  cancelled: () => t("Cancel job"),
};

let listFilter = "open";

export async function render(view, { params, navigate, refreshCounts }) {
  if (params[0]) return renderDetail(view, params[0], { navigate, refreshCounts });
  return renderList(view, { navigate });
}

// ---------- helpers ----------
const titleCase = s => (s ? String(s).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : "");
function carLine(v, withFuel = false) {
  if (!v) return "";
  const parts = [v.year, v.make, v.model].filter(Boolean); // the Hub stores names already tidied ("Mercedes-Benz", "AMG GT")
  if (withFuel && v.fuel_type) parts.push(`· ${t(titleCase(v.fuel_type))}`);
  return parts.join(" ");
}
const statusChip = s => chip(s, STATUS_LABELS[s] || s);
const listStyle = "margin:0;padding-left:20px;display:grid;gap:6px";
function sectionTitle(text, iconName) {
  const art = iconName ? icon(iconName) : null;
  if (art) art.style.cssText = "width:20px;height:20px;flex:none"; // stays small when a longer (e.g. Polish) title wraps
  return h("h2.h2", { style: "display:flex;align-items:center;gap:10px" }, art, text);
}
// Fuel types and tool names that come from the server, listed so they get Polish entries.
N_("Petrol"); N_("Diesel"); N_("Electricity"); N_("Hybrid electric"); N_("Gas bi-fuel"); N_("Workshop diagnostics");

// ---------- list ----------
async function renderList(view, { navigate }) {
  const box = h("div");
  const seg = segmented([["open", t("Open")], ["mine", t("Mine")], ["completed", t("Completed")]], listFilter, v => { listFilter = v; load(); });
  const newBtn = h("button.btn.primary", { type: "button", onclick: () => newJobSheet(navigate) }, icon("plus"), t("New job"));
  view.replaceChildren(pageHead(t("Workshop"), t("Jobs"), newBtn), h("div.stack", seg.el, box));

  let seq = 0;
  async function load() {
    const mine = ++seq;
    box.replaceChildren(loading());
    const q = listFilter === "completed" ? "status=completed" : listFilter === "mine" ? "status=active&mine=1" : "status=active";
    try {
      const { jobs } = await api(`/api/jobs?${q}`);
      if (mine !== seq) return;
      if (!jobs.length) {
        const text = listFilter === "completed" ? t("No completed jobs yet.") : listFilter === "mine" ? t("Nothing assigned to you right now.") : t("No open jobs. Nice.");
        box.replaceChildren(empty(text, "jobs", listFilter === "open" ? h("button.btn", { type: "button", onclick: () => newJobSheet(navigate) }, icon("plus"), t("New job")) : null));
        return;
      }
      box.replaceChildren(h("div.list", jobs.map(jobRow)));
    } catch (err) {
      if (mine === seq) box.replaceChildren(empty(err.message, "jobs"));
    }
  }
  load();
}

function jobRow(j) {
  const car = carLine(j);
  const sub = [j.reg ? jobTitle(j.title) : null, j.customer_name, j.ref, j.assignee_name ? t("with {name}", { name: j.assignee_name.split(" ")[0] }) : null].filter(Boolean).join(" · ");
  return h("a.row", { href: `#/jobs/${encodeURIComponent(j.id)}` },
    h("span.title", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
      j.reg ? plate(j.reg) : null, h("span", j.reg ? (car || t("Car details not looked up")) : jobTitle(j.title))),
    statusChip(j.status),
    h("span.sub", sub),
  );
}

function newJobSheet(navigate) {
  const form = h("form.form",
    field(t("What's the job?"), h("input.input", { name: "title", required: true, maxlength: 200, placeholder: t("e.g. Spare key, ELV fault, Stage 1") })),
    field(t("Registration"), h("input.input.reg", { name: "reg", maxlength: 10, autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "AB12 CDE" }), t("Optional. Links the car if it's already in the Hub.")),
    field(t("Issue"), h("textarea.input", { name: "description", rows: 4, maxlength: 4000, placeholder: t("What the customer said, symptoms, fault codes") })),
  );
  const submit = h("button.btn.primary", { type: "submit" }, t("Create job"));
  form.append(h("div.sheet-actions", { style: "margin-top:0" }, submit));
  const close = sheet(t("New job"), form);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const body = { title: data.title, description: data.description || undefined, reg: data.reg || undefined };
    submit.disabled = true;
    try {
      const { job } = await api("/api/jobs", { method: "POST", body });
      close();
      toast(t("Job {ref} created.", { ref: job.ref }));
      navigate(`#/jobs/${job.id}`);
    } catch (err) {
      showFieldErrors(form, err);
      toast(err.message, "bad");
    } finally { submit.disabled = false; }
  });
}

// ---------- detail ----------
async function renderDetail(view, id, { navigate, refreshCounts }) {
  const [d, { users }, ai] = await Promise.all([
    api(`/api/jobs/${encodeURIComponent(id)}`),
    api("/api/users").catch(() => ({ users: [] })),
    api("/api/ai/status").catch(() => ({ available: false })),
  ]);
  const base = `/api/jobs/${encodeURIComponent(id)}`;

  const statusBox = h("div.stack");
  const notesBox = h("div.stack");
  const photosBox = h("div.stack");
  const aiBox = h("div.stack");

  async function patch(body, okText) {
    const { job } = await api(base, { method: "PATCH", body });
    d.job = { ...d.job, ...job };
    if (okText) toast(okText);
    return job;
  }

  // ---- header ----
  const v = d.vehicle;
  const head = h("div.stack", { style: "gap:12px;margin-bottom:22px" },
    h("div", h("a.btn.small.ghost", { href: "#/jobs", style: "padding-left:4px" }, icon("back"), t("Jobs"))),
    v?.reg ? h("div", h("span.plate", { style: "font-size:24px;padding:6px 14px;border-radius:7px" }, formatReg(v.reg))) : null,
    v ? h("p", { style: "margin:0;font-size:17px;font-weight:600" }, carLine(v, true) || t("Car details not looked up yet")) : null,
    h("p.kicker", `${d.job.ref}${d.booking ? ` · ${t("booking {ref}", { ref: d.booking.ref })}` : ""}`),
    h("h1.h1.chrome", jobTitle(d.job.title)),
  );

  // ---- customer + issue ----
  const c = d.customer;
  const customerCard = c ? h("section.card.stack",
    h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" },
      h("div", { style: "display:grid;gap:2px" }, h("span.muted.small", t("Customer")), h("strong", c.name)),
      c.phone ? h("a.btn.primary", { href: `tel:${c.phone}` }, icon("phone"), fmtPhone(c.phone)) : h("span.muted.small", t("No phone number")),
    ),
  ) : null;
  const issueCard = h("section.card.stack",
    h("h2.h2", t("Issue")),
    d.job.description ? translatable(d.job.description) : h("p.muted", { style: "margin:0" }, t("No description given.")),
  );

  // ---- status ----
  function drawStatus() {
    const s = d.job.status;
    const buttons = NEXT[s].map(to => {
      const cls = to === "cancelled" ? "btn danger" : to === "completed" || (to === "in_progress" && s === "open") ? "btn primary" : "btn";
      return h("button", { type: "button", class: cls, style: "flex:1 1 150px;min-height:56px;font-size:12px", onclick: async e => {
        if (to === "cancelled" && !confirm(t("Cancel this job?"))) return;
        e.currentTarget.disabled = true;
        try { await patch({ status: to }, MOVED[to]); drawStatus(); refreshCounts?.(); }
        catch (err) { toast(err.message, "bad"); drawStatus(); }
      } }, ACTION_LABELS[to](s));
    });
    const times = [
      d.job.started_at ? t("Started {when}", { when: fmtAgo(d.job.started_at) }) : null,
      d.job.completed_at ? t("completed {when}", { when: fmtAgo(d.job.completed_at) }) : null,
    ].filter(Boolean).join(", ");
    statusBox.replaceChildren(
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" }, h("h2.h2", t("Status")), statusChip(s)),
      buttons.length ? h("div", { style: "display:flex;flex-wrap:wrap;gap:10px" }, buttons) : h("p.muted.small", { style: "margin:0" }, t("This job is closed.")),
      times ? h("p.muted.small", { style: "margin:0" }, times) : null,
    );
  }

  // ---- assignee ----
  const assignee = h("select.input", { name: "assigned_to", onchange: async () => {
    try { await patch({ assigned_to: assignee.value || null }, assignee.value ? t("Assigned to {name}.", { name: assignee.selectedOptions[0].textContent }) : t("Unassigned.")); }
    catch (err) { toast(err.message, "bad"); assignee.value = d.job.assigned_to || ""; }
  } },
  h("option", { value: "" }, t("Nobody yet")),
  users.map(u => h("option", { value: u.id, selected: u.id === d.job.assigned_to }, u.name)));

  // ---- car details: mileage + VIN ----
  const mileage = h("input.input", { name: "mileage", inputmode: "numeric", pattern: "[0-9]*", maxlength: 6, autocomplete: "off", value: d.job.mileage ?? "", placeholder: v?.last_mileage ? t("Last known {miles}", { miles: v.last_mileage }) : t("Miles on the clock") });
  const vinInput = h("input.input.mono", { name: "vin", maxlength: 17, autocapitalize: "characters", autocomplete: "off", spellcheck: "false", value: v?.vin || "", placeholder: t("17 characters"), style: "text-transform:uppercase;letter-spacing:.08em" });
  vinInput.addEventListener("input", () => {
    const pos = vinInput.selectionStart;
    vinInput.value = vinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    try { vinInput.setSelectionRange(pos, pos); } catch {}
  });
  const carForm = h("form.form",
    h("div.form-row",
      field(t("Mileage"), mileage),
      v ? field("VIN", vinInput, t("From the scan tool or the windscreen plate.")) : null,
    ),
    h("div", h("button.btn", { type: "submit" }, t("Save car details"))),
  );
  carForm.addEventListener("submit", async e => {
    e.preventDefault();
    showFieldErrors(carForm, null);
    const body = {};
    const m = mileage.value.trim();
    if (m) {
      if (!/^\d{1,6}$/.test(m)) return showFieldErrors(carForm, { fields: { mileage: t("Whole miles, up to 999999.") } });
      body.mileage = Number(m);
    }
    const vn = vinInput.value.trim();
    if (v && vn && vn !== (v.vin || "")) {
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vn)) return showFieldErrors(carForm, { fields: { vin: t("A VIN is 17 letters and numbers (no I, O or Q).") } });
      body.vin = vn;
    }
    if (!Object.keys(body).length) return toast(t("Nothing to save."));
    try {
      const res = await api(`${base}/vehicle`, { method: "PATCH", body });
      d.job = { ...d.job, ...res.job };
      if (res.vehicle) d.vehicle = { ...d.vehicle, ...res.vehicle };
      toast(t("Car details saved."));
    } catch (err) { showFieldErrors(carForm, err); toast(err.message, "bad"); }
  });

  // ---- notes ----
  function drawNotes() {
    const input = h("textarea.input", { name: "body", rows: 3, maxlength: 4000, placeholder: t("What you found, codes, parts ordered…") });
    const add = h("button.btn.primary", { type: "submit" }, t("Add note"));
    const form = h("form.form", { style: "gap:10px" }, field(t("Add a note"), input), h("div", add));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!input.value.trim()) return input.focus();
      add.disabled = true;
      try {
        const { note } = await api(`${base}/notes`, { method: "POST", body: { body: input.value } });
        d.notes = [...d.notes, note];
        drawNotes();
      } catch (err) { showFieldErrors(form, err); toast(err.message, "bad"); add.disabled = false; }
    });
    notesBox.replaceChildren(
      sectionTitle(t("Notes")),
      d.notes.length
        ? h("div.list", d.notes.map(n => h("div.row",
          h("span.title", n.author_name || t("Someone")), h("span.muted.small", fmtAgo(n.created_at)),
          h("div", { style: "grid-column:1/-1" }, translatable(n.body)))))
        : h("p.muted.small", { style: "margin:0" }, t("No notes yet.")),
      form,
    );
  }

  // ---- photos ----
  function drawPhotos() {
    const picker = h("input.sr", { type: "file", accept: "image/*", capture: "environment", multiple: true });
    const label = h("label.btn.primary", { style: "cursor:pointer" }, icon("camera"), t("Add photo"), picker);
    picker.addEventListener("change", async () => {
      const files = [...picker.files];
      picker.value = "";
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) { toast(t("{name} is over 10 MB.", { name: f.name }), "bad"); continue; }
        const fd = new FormData();
        fd.append("file", f, f.name);
        label.setAttribute("aria-busy", "true");
        try {
          const { file } = await api(`${base}/files`, { method: "POST", body: fd });
          d.files = [...d.files, file];
          drawPhotos();
          toast(t("Photo added."));
        } catch (err) { toast(err.message, "bad"); }
        finally { label.removeAttribute("aria-busy"); }
      }
    });
    const grid = d.files.length
      ? h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px" },
        d.files.map(f => h("button", { type: "button", "aria-label": f.caption || t("Open photo"), style: "padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--raise);cursor:pointer;aspect-ratio:1", onclick: () => viewPhoto(f) },
          h("img", { src: f.url, alt: f.caption || t("Job photo"), loading: "lazy", style: "display:block;width:100%;height:100%;object-fit:cover" }))))
      : h("p.muted.small", { style: "margin:0" }, t("No photos yet. Snap the dash, the codes, the part numbers."));
    photosBox.replaceChildren(
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" }, sectionTitle(t("Photos")), label),
      grid,
    );
  }

  function viewPhoto(f) {
    const del = h("button.btn.danger", { type: "button", onclick: async () => {
      if (!confirm(t("Delete this photo?"))) return;
      try {
        await api(`${base}/files/${encodeURIComponent(f.id)}`, { method: "DELETE" });
        d.files = d.files.filter(x => x.id !== f.id);
        close(); drawPhotos(); toast(t("Photo deleted."));
      } catch (err) { toast(err.message, "bad"); }
    } }, t("Delete"));
    const open = h("a.btn", { href: f.url, target: "_blank", rel: "noopener" }, t("Open full size"));
    const close = sheet(f.caption || t("Photo"),
      h("div.stack",
        h("img", { src: f.url, alt: f.caption || t("Job photo"), style: "display:block;width:100%;max-height:70dvh;object-fit:contain;border-radius:10px;background:#000" }),
        h("p.muted.small", { style: "margin:0" }, t("Added {when}", { when: fmtAgo(f.created_at) }))),
      [del, open]);
  }

  // ---- Ask AI ----
  function drawAi() {
    const ask = h("button.btn.primary", { type: "button", style: "min-height:52px", onclick: async () => {
      ask.disabled = true;
      ask.replaceChildren(h("span.spinner"), t("Thinking…"));
      try {
        const { suggestion } = await api(`/api/ai/jobs/${encodeURIComponent(id)}/suggest`, { method: "POST" });
        d.suggestion = suggestion;
      } catch (err) { toast(err.message, "bad"); }
      drawAi();
    } }, icon("spark"), d.suggestion ? t("Ask again") : t("Ask AI"));
    aiBox.replaceChildren(
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" }, sectionTitle(t("Tool suggestions"), "spark"), ask),
      h("p.muted.small", { style: "margin:0" },
        t("Suggestions are a starting point, not a diagnosis. Check the car and back up the data before acting."),
        ai.available ? null : ` ${t("AI isn't connected yet, so these come from the workshop's own rules.")}`),
      d.suggestion ? suggestionView(d.suggestion) : null,
    );
  }

  function suggestionView(s) {
    const tone = { high: "good", medium: "warn", low: "bad" }[s.confidence] || "";
    const fb = (value, text) => h("button.btn.small", { type: "button", "aria-pressed": String(s.feedback === value), class: s.feedback === value ? "primary" : "", onclick: async () => {
      try {
        const { suggestion } = await api(`/api/ai/suggestions/${encodeURIComponent(s.id)}/feedback`, { method: "POST", body: { feedback: value } });
        d.suggestion = { ...d.suggestion, feedback: suggestion.feedback };
        drawAi();
        toast(t("Thanks, noted."));
      } catch (err) { toast(err.message, "bad"); }
    } }, text);
    const sub = text => h("h3", { style: "margin:4px 0 0;font:600 13px/1.3 var(--body);color:var(--mist)" }, text);
    return h("div.stack", { style: "gap:12px;border-top:1px solid var(--line);padding-top:14px" },
      h("div", { style: "display:flex;flex-wrap:wrap;gap:8px" },
        h("span.chip", { class: s.source === "ai" ? "info" : "dim" }, s.source === "ai" ? t("Suggested by AI") : t("Suggested by rules")),
        h("span.chip", { class: tone }, CONFIDENCE[s.confidence] || s.confidence),
        h("span.muted.small", { style: "align-self:center" }, fmtAgo(s.created_at))),
      h("p", { style: "margin:0" }, s.summary),
      s.likely_causes.length ? [sub(t("Likely causes")), h("ul", { style: listStyle }, s.likely_causes.map(x => h("li", x)))] : null,
      s.recommended_tools.length ? [sub(t("Tools to use")), h("div.list", s.recommended_tools.map(tool => h("div.row",
        h("span.title", t(tool.tool)),
        h("span", { style: "grid-column:1/-1" }, tool.function),
        h("span.sub", tool.why))))] : null,
      s.steps.length ? [sub(t("Steps")), h("ol", { style: listStyle }, s.steps.map(x => h("li", x)))] : null,
      s.cautions.length ? h("div", { role: "note", style: "display:grid;gap:8px;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb, var(--warn) 45%, var(--line));background:rgba(242,200,121,.06)" },
        h("strong", { style: "color:var(--warn);font-size:13px" }, t("Cautions")),
        h("ul", { style: listStyle }, s.cautions.map(x => h("li", x)))) : null,
      s.needs_more_info.length ? [sub(t("Would help to know")), h("ul", { style: listStyle }, s.needs_more_info.map(x => h("li", x)))] : null,
      h("div", { style: "display:flex;flex-wrap:wrap;align-items:center;gap:8px" }, h("span.muted.small", t("Was this useful?")), fb("helpful", t("Helpful")), fb("not_helpful", t("Not helpful"))),
    );
  }

  drawStatus(); drawNotes(); drawPhotos(); drawAi();
  view.replaceChildren(
    head,
    h("div.grid-2", { style: "align-items:start" },
      h("div.stack",
        customerCard,
        issueCard,
        h("section.card.stack", statusBox),
        h("section.card.stack", h("h2.h2", t("Job details")), field(t("Assigned to"), assignee), carForm),
      ),
      h("div.stack",
        h("section.card.stack", aiBox),
        h("section.card.stack", photosBox),
        h("section.card.stack", notesBox),
      ),
    ),
  );
  document.title = `${v?.reg ? formatReg(v.reg) : d.job.ref} · ${t("Jobs")} · Curve Hub`;
}
