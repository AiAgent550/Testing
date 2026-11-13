// "Email the customer": one sheet for job reports (photos and videos), invoices, quotes and payment reminders.
// The message is pre-filled from the job and the invoice and can be edited before sending. Customer emails are
// written in English or Polish (the customer's language, not the dashboard's).
import { api, chip, field, formatReg, h, icon, locale, segmented, sheet, showFieldErrors, t, tn, toast } from "./core.js";
import { fmtSize } from "./media.js";

// ---------- money and dates, shared with the invoices page ----------
export const fmtMoney = pence => new Intl.NumberFormat(locale(), { style: "currency", currency: "GBP" }).format((pence || 0) / 100);
export const fmtDay = iso => (iso ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`)) : "");
/** "£12.50", "12,5" or "12" -> 1250 pence; null when it isn't a number. */
export function toPence(text) {
  const s = String(text ?? "").replace(/[£\s,]/g, m => (m === "," ? "." : "")).trim();
  if (!s || !/^-?\d*(\.\d{0,2})?$/.test(s) || s === "-" || s === ".") return null;
  return Math.round(Number(s) * 100);
}
export const fromPence = p => (p === null || p === undefined ? "" : (p / 100).toFixed(2));

const DOC_STATUS = { draft: "Draft", sent: "Sent", paid: "Paid", void: "Void", accepted: "Accepted", declined: "Declined" };
export function docChip(doc) {
  if (doc.overdue) return chip("failed", t("Overdue"));
  const tone = { draft: "draft", sent: "queued", paid: "sent", void: "skipped", accepted: "sent", declined: "skipped" }[doc.status] || doc.status;
  return chip(tone, t(DOC_STATUS[doc.status] || doc.status));
}
// Listed so they get Polish entries.
void [t("Draft"), t("Sent"), t("Paid"), t("Void"), t("Accepted"), t("Declined")];

// ---------- customer email templates ----------
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "";
const gbp = p => `£${(p / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const day = (iso, lang) => (iso ? new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`)) : "");

function template(purpose, lang, { name, car, reg, work, doc }) {
  const hi = lang === "pl" ? `Dzień dobry${name ? ` ${name}` : ""},` : `Hi${name ? ` ${name}` : ""},`;
  const bye = lang === "pl" ? "Pozdrawiamy,\nCurve Performance\n07734 272203" : "Thanks,\nCurve Performance\n07734 272203";
  const carText = [car, reg].filter(Boolean).join(" ");
  const bank = lang === "pl"
    ? `Prosimy o przelew na konto M&K Auto Services Limited, podając ${doc?.number} jako tytuł przelewu. Dane do przelewu są na fakturze.`
    : `Please pay by bank transfer to M&K Auto Services Limited, quoting ${doc?.number} as the reference. Bank details are on the invoice.`;
  if (purpose === "invoice" && doc) {
    const due = doc.due_date ? (lang === "pl" ? `do ${day(doc.due_date, lang)}` : `by ${day(doc.due_date, lang)}`) : lang === "pl" ? "przy odbiorze" : "on receipt";
    return lang === "pl"
      ? { subject: `Faktura ${doc.number}${reg ? ` – ${reg}` : ""} – Curve Performance`,
          message: `${hi}\n\nW załączniku przesyłamy fakturę ${doc.number}${carText ? ` za ${carText}` : ""}. Do zapłaty: ${gbp(doc.balance_pence)}, płatne ${due}.\n\n${bank}\n\nDziękujemy za skorzystanie z naszych usług.\n\n${bye}` }
      : { subject: `Invoice ${doc.number}${reg ? ` – ${reg}` : ""} – Curve Performance`,
          message: `${hi}\n\nPlease find attached invoice ${doc.number}${carText ? ` for your ${carText}` : ""}. The balance of ${gbp(doc.balance_pence)} is due ${due}.\n\n${bank}\n\nThanks for your business.\n\n${bye}` };
  }
  if (purpose === "reminder" && doc) {
    return lang === "pl"
      ? { subject: `Przypomnienie: faktura ${doc.number} – Curve Performance`,
          message: `${hi}\n\nUprzejmie przypominamy, że faktura ${doc.number} na kwotę ${gbp(doc.balance_pence)}${doc.due_date ? ` była płatna do ${day(doc.due_date, lang)}` : ""} nie została jeszcze opłacona. Kopię przesyłamy w załączniku.\n\n${bank}\n\nJeśli płatność została już wysłana, prosimy zignorować tę wiadomość.\n\n${bye}` }
      : { subject: `Reminder: invoice ${doc.number} – Curve Performance`,
          message: `${hi}\n\nJust a friendly reminder that invoice ${doc.number} for ${gbp(doc.balance_pence)}${doc.due_date ? `, due on ${day(doc.due_date, lang)},` : ""} is still showing as unpaid. A copy is attached.\n\n${bank}\n\nIf you've already paid, thank you, and please ignore this email.\n\n${bye}` };
  }
  if (purpose === "quote" && doc) {
    return lang === "pl"
      ? { subject: `Wycena ${doc.number}${reg ? ` – ${reg}` : ""} – Curve Performance`,
          message: `${hi}\n\nW załączniku przesyłamy wycenę ${doc.number}${carText ? ` dla ${carText}` : ""} na kwotę ${gbp(doc.total_pence)}${doc.due_date ? `, ważną do ${day(doc.due_date, lang)}` : ""}.\n\nAby umówić termin, wystarczy odpowiedzieć na tę wiadomość albo zadzwonić pod 07734 272203.\n\n${bye}` }
      : { subject: `Quote ${doc.number}${reg ? ` – ${reg}` : ""} – Curve Performance`,
          message: `${hi}\n\nPlease find attached quote ${doc.number}${carText ? ` for your ${carText}` : ""}, for ${gbp(doc.total_pence)}${doc.due_date ? `, valid until ${day(doc.due_date, lang)}` : ""}.\n\nTo book in, just reply to this email or call us on 07734 272203.\n\n${bye}` };
  }
  // Job report.
  return lang === "pl"
    ? { subject: `${carText || "Twoje auto"} – raport z naprawy – Curve Performance`,
        message: `${hi}\n\nDziękujemy za wybór Curve Performance. Prace przy ${carText || "Twoim aucie"} zostały zakończone.\n\nWykonane prace:\n${work || "-"}\n\nZdjęcia z naprawy są w załączniku lub pod linkiem poniżej.\n\nW razie pytań wystarczy odpowiedzieć na tę wiadomość albo zadzwonić pod 07734 272203.\n\n${bye}` }
    : { subject: `Your ${carText || "car"} – job report – Curve Performance`,
        message: `${hi}\n\nThanks for choosing Curve Performance. The work on your ${carText || "car"} is done.\n\nWork carried out:\n${work || "-"}\n\nPhotos from the job are attached or at the link below.\n\nAny questions, just reply to this email or call us on 07734 272203.\n\n${bye}` };
}

/**
 * Opens the email sheet.
 * job: the job detail (customer, vehicle, job, files) or null; docs: that job's invoices/quotes; doc: a single document
 * when opened from the invoices page.
 */
export async function sendSheet({ purpose = "report", job = null, docs = [], doc = null, onSent }) {
  const status = await api("/api/mail/status").catch(() => ({ available: false }));
  const allDocs = (doc ? [doc] : docs).filter(x => x.status !== "void");
  const files = job?.files || [];
  const v = job?.vehicle;
  const car = v ? [v.make, v.model].filter(Boolean).join(" ") : doc?.vehicle_desc || "";
  const reg = formatReg(v?.reg || doc?.vehicle_reg || "");
  const name = firstName(job?.customer?.name || doc?.bill_name);
  const notes = (job?.notes || []).map(n => n.body).join("\n");
  const work = [job?.job?.title, notes].filter(Boolean).join("\n").trim();

  const options = [["report", t("Job report")]];
  if (allDocs.some(x => x.kind === "invoice")) options.push(["invoice", t("Invoice")], ["reminder", t("Reminder")]);
  if (allDocs.some(x => x.kind === "quote")) options.push(["quote", t("Quote")]);
  if (!options.some(([v]) => v === purpose)) purpose = options[0][0];
  let lang = "en";

  const to = h("input.input", { name: "to", type: "email", inputmode: "email", autocomplete: "off", value: job?.customer?.email || doc?.bill_email || "", placeholder: "name@example.com" });
  const subject = h("input.input", { name: "subject", maxlength: 200 });
  const message = h("textarea.input", { name: "message", rows: 12, maxlength: 8000 });
  const docList = h("div.stack", { style: "gap:6px" });
  const fileList = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px" });
  const sizeNote = h("p.muted.small", { style: "margin:0" });
  const picked = new Set(), pickedDocs = new Set();

  const docFor = p => allDocs.find(x => (p === "quote" ? x.kind === "quote" : x.kind === "invoice")) || null;
  function fill() {
    const d = purpose === "report" ? null : docFor(purpose);
    const tpl = template(purpose, lang, { name, car, reg, work, doc: d });
    subject.value = tpl.subject;
    message.value = tpl.message;
    pickedDocs.clear();
    if (d) pickedDocs.add(d.id);
    picked.clear();
    if (purpose === "report") files.forEach(f => picked.add(f.id));
    drawPicks();
  }
  function drawPicks() {
    docList.replaceChildren(allDocs.map(x => h("label", { style: "display:flex;align-items:center;gap:10px;cursor:pointer" },
      h("input", { type: "checkbox", checked: pickedDocs.has(x.id), onchange: e => { e.target.checked ? pickedDocs.add(x.id) : pickedDocs.delete(x.id); } }),
      h("span", `${x.number} · ${fmtMoney(x.kind === "invoice" ? x.balance_pence : x.total_pence)} (PDF)`))));
    fileList.replaceChildren(files.map(f => {
      const on = picked.has(f.id);
      return h("button", { type: "button", "aria-pressed": String(on), "aria-label": f.kind === "video" ? t("Video") : t("Photo"),
        style: `position:relative;padding:0;aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;background:var(--raise);border:2px solid ${on ? "var(--led)" : "var(--line)"};opacity:${on ? 1 : 0.55}`,
        onclick: () => { on ? picked.delete(f.id) : picked.add(f.id); drawPicks(); } },
        f.kind === "video"
          ? [h("video", { src: `${f.url}#t=0.5`, muted: true, preload: "metadata", playsInline: true, style: "width:100%;height:100%;object-fit:cover;pointer-events:none" }), h("span", { style: "position:absolute;left:6px;bottom:6px;display:grid;place-items:center;width:22px;height:22px;border-radius:99px;background:rgba(0,0,0,.65)" }, icon("play"))]
          : h("img", { src: f.thumb_url || f.url, alt: "", loading: "lazy", style: "width:100%;height:100%;object-fit:cover" }),
        on ? h("span", { style: "position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:99px;background:var(--led);color:#000;display:grid;place-items:center;font-size:13px;font-weight:700" }, "✓") : null);
    }));
    const chosen = files.filter(f => picked.has(f.id));
    const videos = chosen.filter(f => f.kind === "video").length;
    const photoBytes = chosen.filter(f => f.kind === "photo").reduce((n, f) => n + (f.preview_size || f.size), 0);
    sizeNote.textContent = chosen.length
      ? [tn(chosen.length - videos, "{n} photo|{n} photos"), videos ? tn(videos, "{n} video|{n} videos") : null, `≈ ${fmtSize(photoBytes)}`].filter(Boolean).join(" · ") + ". " +
        (videos ? t("Videos go as a private link that works for 30 days; photos are attached.") : t("Photos are attached to the email."))
      : t("No photos or videos chosen.");
  }

  const purposeSeg = segmented(options, purpose, v => { purpose = v; fill(); });
  const langSeg = segmented([["en", "English"], ["pl", "Polski"]], lang, v => { lang = v; fill(); });
  const form = h("form.form", { id: "send-email", novalidate: true },
    status.available ? null : h("p.hint", t("Email sending isn't switched on yet, so this won't send until it's set up.")),
    h("div.stack", { style: "gap:8px" }, purposeSeg.el, h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" }, h("span.muted.small", t("Customer's language")), langSeg.el)),
    field(t("To"), to),
    field(t("Subject"), subject),
    field(t("Message"), message, t("From {from}. Replies go to your Gmail.", { from: status.from || "info@curveperformance.co.uk" })),
    allDocs.length ? h("div.stack", { style: "gap:8px" }, h("span.muted.small", t("Attach")), docList) : null,
    files.length ? h("div.stack", { style: "gap:8px" }, h("span.muted.small", t("Photos and videos")), fileList, sizeNote) : null,
  );
  const sendBtn = h("button.btn.primary", { type: "submit", form: "send-email" }, icon("send"), t("Send email"));
  const close = sheet(t("Email the customer"), form, [sendBtn]);
  fill();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    showFieldErrors(form, null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.value.trim())) return showFieldErrors(form, { fields: { to: t("Enter a valid email address.") } });
    sendBtn.disabled = true;
    sendBtn.replaceChildren(h("span.spinner"), t("Sending…"));
    try {
      const { email } = await api("/api/mail/send", { method: "POST", body: {
        purpose, to: to.value.trim(), subject: subject.value, message: message.value,
        job_id: job?.job?.id, document_ids: [...pickedDocs], file_ids: files.filter(f => picked.has(f.id)).map(f => f.id),
      } });
      close();
      toast(t("Email sent to {to}.", { to: email.to }));
      onSent?.();
    } catch (err) {
      showFieldErrors(form, err);
      toast(err.message, "bad");
      sendBtn.disabled = false;
      sendBtn.replaceChildren(icon("send"), t("Send email"));
    }
  });
}
