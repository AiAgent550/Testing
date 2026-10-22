// Leads: enquiries spotted in public comments. Reply publicly (after checking the exact text),
// book them in, or dismiss them.
import { SERVICE_LABELS, api, chip, empty, field, fmtAgo, fmtDateTime, h, icon, loading, pageHead, segmented, sheet, showFieldErrors, toast } from "../core.js";

const TABS = [["new", "New"], ["replied", "Replied"], ["booked", "Booked"], ["dismissed", "Dismissed"]];
const PLATFORM = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", google: "Google" };
const URGENCY_TONE = { high: ["no_show", "Urgent"], normal: ["new", "Normal"], low: ["draft", "Low urgency"] };
const MAX_REPLY = 1000;

const row = (...children) => h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, children);
const quote = text => h("blockquote", { style: "margin:0;padding:10px 14px;border-left:3px solid var(--line-strong);border-radius:4px;background:var(--raise);overflow-wrap:anywhere;white-space:pre-wrap" }, text);
const errBox = () => h("p", { hidden: true, role: "alert", style: "margin:0;color:var(--bad);font-size:14px" });
const handleOf = l => (l.author_handle ? `@${String(l.author_handle).replace(/^@/, "")}` : l.author_name || "Someone");

export async function render(view, { params, refreshCounts }) {
  let status = TABS.some(([v]) => v === params[0]) ? params[0] : "new";
  const listBox = h("div.stack");
  const checkBtn = h("button.btn", { type: "button", onclick: checkNow }, icon("spark"), "Check now");
  const seg = segmented(TABS, status, v => { status = v; load(); });
  view.replaceChildren(pageHead("Curve Hub", "Leads", checkBtn), h("div", { style: "margin-bottom:16px" }, seg.el), listBox);

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
          ? empty("No accounts connected yet. Connect Instagram, Facebook or YouTube and the Hub will watch the comments for enquiries.", "leads", h("a.btn.primary", { href: "#/social" }, "Go to Social"))
          : empty(EMPTY[status], "leads"));
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
      const bits = [`${r.new_comments} new comment${r.new_comments === 1 ? "" : "s"}`, `${r.new_leads} new lead${r.new_leads === 1 ? "" : "s"}`];
      toast(r.accounts ? `Checked: ${bits.join(", ")}.` : "No accounts to check yet. Connect one on the Social page.");
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
        h("div.muted.small", `${fmtAgo(l.comment_posted_at || l.created_at)}${l.account_handle ? ` · on @${l.account_handle}` : ""}`)),
      chip(l.status));
    const [tone, urgencyLabel] = URGENCY_TONE[l.urgency] || URGENCY_TONE.normal;
    const vehicle = [l.make, l.model].filter(Boolean).join(" ");
    const chips = row(
      l.service ? chip("", SERVICE_LABELS[l.service] || l.service) : null,
      vehicle ? chip("", vehicle) : null,
      chip(tone, urgencyLabel),
      chip(l.score >= 75 ? "confirmed" : "waiting_parts", `Score ${l.score}`),
    );
    const parts = [head, quote(l.comment_body || "(The original comment isn't stored.)"), h("p", { style: "margin:0" }, l.summary), chips];

    if (l.status === "new") {
      const counter = h("small", `${(l.suggested_reply || "").length} / ${MAX_REPLY}`);
      const text = h("textarea.input", { name: "reply", rows: 4, maxlength: MAX_REPLY }, l.suggested_reply || "");
      let saved = l.suggested_reply || "";
      text.addEventListener("input", () => { counter.textContent = `${text.value.length} / ${MAX_REPLY}`; });
      text.addEventListener("change", async () => {
        const v = text.value.trim();
        if (!v || v === saved) return;
        try { await api(`/api/leads/${l.id}`, { method: "PATCH", body: { suggested_reply: v } }); saved = v; toast("Reply draft saved."); }
        catch (err) { toast(err.message, "bad"); }
      });
      parts.push(h("label.field", h("span", "Suggested reply"), text, counter));
      if (needsReauth || disconnected) {
        parts.push(h("p.muted.small", { style: "margin:0" }, needsReauth
          ? `@${l.account_handle} needs connecting again before you can reply. `
          : "That account has been disconnected. ", h("a", { href: "#/social" }, "Go to Social")));
      }
      parts.push(row(
        h("button.btn.primary", { type: "button", disabled: needsReauth || disconnected, onclick: () => confirmReply(l, text.value.trim()) }, "Reply publicly"),
        h("button.btn", { type: "button", onclick: () => bookIn(l) }, "Book in"),
        h("button.btn.ghost", { type: "button", onclick: () => setStatus(l, "dismissed") }, "Dismiss"),
      ));
    } else if (l.status === "replied") {
      parts.push(h("div.stack", { style: "gap:6px" }, h("span.muted.small", `Replied ${fmtDateTime(l.replied_at)}`), quote(l.suggested_reply || "")));
      parts.push(row(h("button.btn", { type: "button", onclick: () => bookIn(l) }, "Book in")));
    } else if (l.status === "booked") {
      parts.push(row(h("a.btn", { href: `#/bookings/${l.booking_id}` }, "Open booking")));
    } else if (l.status === "dismissed") {
      parts.push(row(h("button.btn", { type: "button", onclick: () => setStatus(l, "new") }, "Move back to New")));
    }
    return h("article.card.stack", parts);
  }

  async function setStatus(l, next) {
    try {
      await api(`/api/leads/${l.id}`, { method: "PATCH", body: { status: next } });
      toast(next === "dismissed" ? "Lead dismissed." : "Lead moved back to New.");
      refreshCounts();
      await load();
    } catch (err) { toast(err.message, "bad"); }
  }

  function confirmReply(l, text) {
    if (!text) { toast("Write a reply first.", "bad"); return; }
    if (text.length > MAX_REPLY) { toast(`Replies can be up to ${MAX_REPLY} characters.`, "bad"); return; }
    const err = errBox();
    const post = h("button.btn.primary", { type: "button" }, "Post reply");
    const close = sheet("Reply publicly", h("div.stack",
      h("p", { style: "margin:0" }, `This will be posted publicly on ${PLATFORM[l.platform] || l.platform}${l.account_handle ? ` as @${l.account_handle}` : ""}, in reply to ${handleOf(l)}:`),
      quote(text),
      h("p.muted.small", { style: "margin:0" }, "Anyone can see it. Check there are no prices, promises or personal details."),
      err,
    ), [post]);
    post.addEventListener("click", async () => {
      post.disabled = true; post.textContent = "Posting…";
      try {
        await api(`/api/leads/${l.id}/reply`, { method: "POST", body: { text } });
        close(); toast("Reply posted."); refreshCounts(); await load();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; post.disabled = false; post.textContent = "Post reply";
      }
    });
  }

  function bookIn(l) {
    const name = String(l.author_name || l.author_handle || "").replace(/^@/, "");
    const service = h("select.input", { name: "service" },
      Object.entries(SERVICE_LABELS).map(([v, label]) => h("option", { value: v, selected: v === (l.service || "other") }, label)));
    const location = h("select.input", { name: "location" },
      h("option", { value: "workshop" }, "At the workshop"),
      h("option", { value: "mobile", selected: /\bmobile\b/i.test(l.comment_body || "") }, "Mobile (we go to them)"));
    const description = [l.summary, l.comment_body ? `Comment: "${l.comment_body}"` : ""].filter(Boolean).join("\n");
    const err = errBox();
    const form = h("form.form",
      field("Name", h("input.input", { name: "name", value: name, autocomplete: "off", required: true }), "From their social handle: change it to their real name if you know it."),
      h("div.form-row",
        field("Phone", h("input.input", { name: "phone", inputmode: "tel", autocomplete: "off" })),
        field("Registration", h("input.input.reg", { name: "reg", autocomplete: "off" })),
      ),
      field("Email", h("input.input", { name: "email", type: "email", autocomplete: "off" })),
      h("div.form-row", field("Service", service), field("Where", location)),
      field("Description", h("textarea.input", { name: "description", rows: 4 }, description)),
      err,
    );
    const save = h("button.btn.primary", { type: "button" }, "Book in");
    const close = sheet("Book in", form, [save]);
    const submit = async e => {
      e?.preventDefault();
      const body = Object.fromEntries([...new FormData(form)].filter(([, v]) => String(v).trim() !== ""));
      save.disabled = true; err.hidden = true;
      try {
        const r = await api(`/api/leads/${l.id}/book`, { method: "POST", body });
        close(); toast(`Booked in${r.booking?.ref ? ` as ${r.booking.ref}` : ""}.`); refreshCounts(); await load();
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
  new: "No new leads. When someone asks about a job in your comments, it shows up here.",
  replied: "Leads you've replied to show up here.",
  booked: "Leads you've booked in show up here.",
  dismissed: "Nothing dismissed.",
};
