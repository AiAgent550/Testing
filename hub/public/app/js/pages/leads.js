// Leads: enquiries spotted in public comments. Reply publicly (after checking the exact text),
// book them in, or dismiss them.
import { SERVICE_LABELS, api, chip, empty, field, fmtAgo, fmtDateTime, h, icon, loading, pageHead, segmented, sheet, showFieldErrors, t, tn, toast, translatable, N_ } from "../core.js";

const TABS = [["new", t("New")], ["replied", t("Replied")], ["booked", t("Booked")], ["dismissed", t("Dismissed")]];
const PLATFORM = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", google: "Google" };
const URGENCY_TONE = { high: ["no_show", t("Urgent")], normal: ["new", t("Normal")], low: ["draft", t("Low urgency")] };
const MAX_REPLY = 1000;

const row = (...children) => h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, children);
const quote = text => h("blockquote", { style: "margin:0;padding:10px 14px;border-left:3px solid var(--line-strong);border-radius:4px;background:var(--raise);overflow-wrap:anywhere;white-space:pre-wrap" }, text);
const errBox = () => h("p", { hidden: true, role: "alert", style: "margin:0;color:var(--bad);font-size:14px" });
const handleOf = l => (l.author_handle ? `@${String(l.author_handle).replace(/^@/, "")}` : l.author_name || t("Someone"));

export async function render(view, { params, refreshCounts }) {
  let status = TABS.some(([v]) => v === params[0]) ? params[0] : "new";
  const listBox = h("div.stack");
  const checkBtn = h("button.btn", { type: "button", onclick: checkNow }, icon("spark"), t("Check now"));
  const seg = segmented(TABS, status, v => { status = v; load(); });
  view.replaceChildren(pageHead("Curve Hub", t("Leads"), checkBtn), h("div", { style: "margin-bottom:16px" }, seg.el), listBox);

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const [{ leads }, accounts] = await Promise.all([
        api(`/api/leads?status=${encodeURIComponent(status)}`),
        status === "new" ? api("/api/social/accounts").catch(() => null) : null,
      ]);
      if (!leads.length) {
        const noAccounts = accounts && !accounts.accounts.length;
        listBox.replaceChildren(noAccounts
          ? empty(t("No accounts connected yet. Connect Instagram, Facebook or YouTube and the Hub will watch the comments for enquiries."), "leads", h("a.btn.primary", { href: "#/social" }, t("Go to Social")))
          : empty(t(EMPTY[status]), "leads"));
        return;
      }
      listBox.replaceChildren(...leads.map(card));
    } catch (err) {
      listBox.replaceChildren(empty(err.message, "leads"));
    }
  }

  async function checkNow() {
    checkBtn.disabled = true;
    try {
      const r = await api("/api/social/poll", { method: "POST", body: {} });
      const bits = [tn(r.new_comments, "{n} new comment|{n} new comments"), tn(r.new_leads, "{n} new lead|{n} new leads")];
      toast(r.accounts ? t("Checked: {result}.", { result: bits.join(", ") }) : t("No accounts to check yet. Connect one on the Social page."));
      for (const e of r.errors || []) toast(`@${e.handle}: ${e.message}`, "bad");
      refreshCounts();
      await load();
    } catch (err) { toast(err.message, "bad"); }
    finally { checkBtn.disabled = false; }
  }

  function card(l) {
    const needsReauth = l.account_status === "needs_reauth";
    const disconnected = l.account_status === "disabled" || !l.account_status;
    const head = h("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap" },
      h("div", h("strong", PLATFORM[l.platform] || l.platform), " · ", h("span", handleOf(l)),
        h("div.muted.small", `${fmtAgo(l.comment_posted_at || l.created_at)}${l.account_handle ? ` · ${t("on @{handle}", { handle: l.account_handle })}` : ""}`)),
      chip(l.status));
    const [tone, urgencyLabel] = URGENCY_TONE[l.urgency] || URGENCY_TONE.normal;
    const vehicle = [l.make, l.model].filter(Boolean).join(" ");
    const chips = row(
      l.service ? chip("", SERVICE_LABELS[l.service] || l.service) : null,
      vehicle ? chip("", vehicle) : null,
      chip(tone, urgencyLabel),
      chip(l.score >= 75 ? "confirmed" : "waiting_parts", t("Score {n}", { n: l.score })),
    );
    const parts = [head, quote(l.comment_body || t("(The original comment isn't stored.)")),
      translatable(l.summary, "margin:0", [l.summary, l.comment_body].filter(Boolean).join("\n\n")), chips];

    if (l.status === "new") {
      const counter = h("small", `${(l.suggested_reply || "").length} / ${MAX_REPLY}`);
      const text = h("textarea.input", { name: "reply", rows: 4, maxlength: MAX_REPLY }, l.suggested_reply || "");
      let saved = l.suggested_reply || "";
      text.addEventListener("input", () => { counter.textContent = `${text.value.length} / ${MAX_REPLY}`; });
      text.addEventListener("change", async () => {
        const v = text.value.trim();
        if (!v || v === saved) return;
        try { await api(`/api/leads/${l.id}`, { method: "PATCH", body: { suggested_reply: v } }); saved = v; toast(t("Reply draft saved.")); }
        catch (err) { toast(err.message, "bad"); }
      });
      parts.push(h("label.field", h("span", t("Suggested reply")), text, counter));
      if (needsReauth || disconnected) {
        parts.push(h("p.muted.small", { style: "margin:0" }, needsReauth
          ? `${t("@{handle} needs connecting again before you can reply.", { handle: l.account_handle })} `
          : `${t("That account has been disconnected.")} `, h("a", { href: "#/social" }, t("Go to Social"))));
      }
      parts.push(row(
        h("button.btn.primary", { type: "button", disabled: needsReauth || disconnected, onclick: () => confirmReply(l, text.value.trim()) }, t("Reply publicly")),
        h("button.btn", { type: "button", onclick: () => bookIn(l) }, t("Book in")),
        h("button.btn.ghost", { type: "button", onclick: () => setStatus(l, "dismissed") }, t("Dismiss")),
      ));
    } else if (l.status === "replied") {
      parts.push(h("div.stack", { style: "gap:6px" }, h("span.muted.small", t("Replied {when}", { when: fmtDateTime(l.replied_at) })), quote(l.suggested_reply || "")));
      parts.push(row(h("button.btn", { type: "button", onclick: () => bookIn(l) }, t("Book in"))));
    } else if (l.status === "booked") {
      parts.push(row(h("a.btn", { href: `#/bookings/${l.booking_id}` }, t("Open booking"))));
    } else if (l.status === "dismissed") {
      parts.push(row(h("button.btn", { type: "button", onclick: () => setStatus(l, "new") }, t("Move back to New"))));
    }
    return h("article.card.stack", parts);
  }

  async function setStatus(l, next) {
    try {
      await api(`/api/leads/${l.id}`, { method: "PATCH", body: { status: next } });
      toast(next === "dismissed" ? t("Lead dismissed.") : t("Lead moved back to New."));
      refreshCounts();
      await load();
    } catch (err) { toast(err.message, "bad"); }
  }

  function confirmReply(l, text) {
    if (!text) { toast(t("Write a reply first."), "bad"); return; }
    if (text.length > MAX_REPLY) { toast(t("Replies can be up to {n} characters.", { n: MAX_REPLY }), "bad"); return; }
    const err = errBox();
    const post = h("button.btn.primary", { type: "button" }, t("Post reply"));
    const where = PLATFORM[l.platform] || l.platform;
    const close = sheet(t("Reply publicly"), h("div.stack",
      h("p", { style: "margin:0" }, l.account_handle
        ? t("This will be posted publicly on {platform} as @{account}, in reply to {who}:", { platform: where, account: l.account_handle, who: handleOf(l) })
        : t("This will be posted publicly on {platform}, in reply to {who}:", { platform: where, who: handleOf(l) })),
      quote(text),
      h("p.muted.small", { style: "margin:0" }, t("Anyone can see it. Check there are no prices, promises or personal details.")),
      err,
    ), [post]);
    post.addEventListener("click", async () => {
      post.disabled = true; post.textContent = t("Posting…");
      try {
        await api(`/api/leads/${l.id}/reply`, { method: "POST", body: { text } });
        close(); toast(t("Reply posted.")); refreshCounts(); await load();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; post.disabled = false; post.textContent = t("Post reply");
      }
    });
  }

  function bookIn(l) {
    const name = String(l.author_name || l.author_handle || "").replace(/^@/, "");
    const service = h("select.input", { name: "service" },
      Object.entries(SERVICE_LABELS).map(([v, label]) => h("option", { value: v, selected: v === (l.service || "other") }, label)));
    const location = h("select.input", { name: "location" },
      h("option", { value: "workshop" }, t("At the workshop")),
      h("option", { value: "mobile", selected: /\bmobile\b/i.test(l.comment_body || "") }, t("Mobile (we go to them)")));
    const description = [l.summary, l.comment_body ? `Comment: "${l.comment_body}"` : ""].filter(Boolean).join("\n");
    const err = errBox();
    const form = h("form.form",
      field(t("Name"), h("input.input", { name: "name", value: name, autocomplete: "off", required: true }), t("From their social handle: change it to their real name if you know it.")),
      h("div.form-row",
        field(t("Phone"), h("input.input", { name: "phone", inputmode: "tel", autocomplete: "off" })),
        field(t("Registration"), h("input.input.reg", { name: "reg", autocomplete: "off" })),
      ),
      field(t("Email"), h("input.input", { name: "email", type: "email", autocomplete: "off" })),
      h("div.form-row", field(t("Service"), service), field(t("Where"), location)),
      field(t("Description"), h("textarea.input", { name: "description", rows: 4 }, description)),
      err,
    );
    const save = h("button.btn.primary", { type: "button" }, t("Book in"));
    const close = sheet(t("Book in"), form, [save]);
    const submit = async e => {
      e?.preventDefault();
      const body = Object.fromEntries([...new FormData(form)].filter(([, v]) => String(v).trim() !== ""));
      save.disabled = true; err.hidden = true;
      try {
        const r = await api(`/api/leads/${l.id}/book`, { method: "POST", body });
        close(); toast(r.booking?.ref ? t("Booked in as {ref}.", { ref: r.booking.ref }) : t("Booked in.")); refreshCounts(); await load();
      } catch (e2) {
        showFieldErrors(form, e2);
        err.textContent = e2.message; err.hidden = false; save.disabled = false;
      }
    };
    form.addEventListener("submit", submit);
    save.addEventListener("click", submit);
  }

  await load();
}

const EMPTY = {
  new: N_("No new leads. When someone asks about a job in your comments, it shows up here."),
  replied: N_("Leads you've replied to show up here."),
  booked: N_("Leads you've booked in show up here."),
  dismissed: N_("Nothing dismissed."),
};
