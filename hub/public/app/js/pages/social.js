// Social: connected accounts, recent public comments, and posting one video/photo to several accounts.
import { api, chip, empty, field, fmtAgo, h, icon, loading, pageHead, sheet, showFieldErrors, t, toast, translatable } from "../core.js";

const PLATFORM = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", google: "Google" };
const CAN_PUBLISH = new Set(["instagram", "facebook"]);
const MAX_CAPTION = 2200, MAX_MB = 90;

const CONNECT_ERRORS = {
  state: t("That sign-in link had expired or was already used. Try connecting again."),
  denied: t("Connecting was cancelled."),
  code: t("The platform didn't send back a sign-in code. Try again."),
  "no-accounts": t("No pages or channels were found on that login. Check you picked the business's Page (and its Instagram) when asked."),
  needs_reauth: t("The platform didn't grant the permissions the Hub needs. Try again and allow everything it asks for."),
  not_configured: t("This platform isn't set up on the Hub yet."),
  not_supported: t("That account type isn't supported (for YouTube, the Google account needs a channel)."),
  rate_limited: t("The platform is busy. Wait a few minutes and try again."),
};

const flex = (...c) => h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, c);
const errBox = () => h("p", { hidden: true, role: "alert", style: "margin:0;color:var(--bad);font-size:14px" });

export async function render(view, { params }) {
  // Back from a Connect button: #/social/connected/<provider> or #/social/error/<provider>-<reason>
  if (params[0] === "connected") toast(params[1] === "google" ? t("YouTube connected.") : t("Instagram and Facebook connected."));
  if (params[0] === "error") {
    const reason = String(params[1] || "").replace(/^(meta|google)-/, "");
    toast(CONNECT_ERRORS[reason] || t("Connecting didn't work. Try again."), "bad");
  }
  if (params.length) history.replaceState(null, "", "#/social");

  const accountsBox = h("div.stack"), commentsBox = h("div.stack"), postsBox = h("div.stack");
  const newPostBtn = h("button.btn.primary", { type: "button", onclick: () => composer() }, icon("plus"), t("New post"));
  view.replaceChildren(
    pageHead("Curve Hub", t("Social"), newPostBtn),
    h("div.stack",
      h("section.card.stack", h("h2.h2", t("Accounts")), accountsBox),
      h("section.card.stack", h("h2.h2", t("Posts")), postsBox),
      h("section.card.stack", h("h2.h2", t("Recent comments")), commentsBox),
    ),
  );

  let accounts = [], providers = {};

  async function loadAccounts() {
    accountsBox.replaceChildren(loading());
    const data = await api("/api/social/accounts");
    accounts = data.accounts; providers = data.providers;
    const list = accounts.length
      ? h("div.list", accounts.map(a => h("div.row",
        h("span.title", { style: "grid-column:1/-1" }, `${PLATFORM[a.platform] || a.platform} · @${a.handle}`),
        h("div", { style: "grid-column:1/-1" }, flex(
          a.demo ? chip("draft", t("Demo")) : null,
          a.status === "active" ? chip("confirmed", t("Connected")) : chip("failed", t("Reconnect needed")),
          h("button.btn.small.ghost", { type: "button", onclick: () => disconnect(a) }, t("Disconnect")),
        )),
        h("span.sub", a.last_polled_at ? t("Comments checked {when}", { when: fmtAgo(a.last_polled_at) }) : t("Not checked yet")),
      )))
      : h("p.muted", { style: "margin:0" }, t("No accounts connected yet."));

    const connect = (label, provider, configured, secrets) => configured
      ? h("a.btn", { href: `/api/social/connect/${provider}/start` }, label)
      : h("span", { style: "display:grid;gap:4px" },
        h("button.btn", { type: "button", disabled: true }, label),
        h("small.muted", t("Needs {secrets} in the Hub's settings on Cloudflare.", { secrets })));
    accountsBox.replaceChildren(
      list,
      flex(
        connect(t("Connect Instagram & Facebook"), "meta", providers.meta?.configured, "META_APP_ID + META_APP_SECRET"),
        connect(t("Connect YouTube"), "google", providers.google?.configured, "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET"),
        h("span", { style: "display:inline-flex;gap:8px;align-items:center" }, h("button.btn", { type: "button", disabled: true }, "TikTok"), chip("draft", t("Coming soon"))),
        providers.demo?.available ? h("button.btn.ghost", { type: "button", onclick: addDemo }, t("Add demo account")) : null,
      ),
      h("p.muted.small", { style: "margin:0" }, t("The Hub checks public comments every 10 minutes (not private messages) and flags enquiries on the Leads page.")),
    );
  }

  async function addDemo() {
    try { await api("/api/social/accounts/mock", { method: "POST", body: {} }); toast(t("Demo account added. Use Check now on Leads to load its sample comments.")); await loadAccounts(); }
    catch (err) { toast(err.message, "bad"); }
  }

  function disconnect(a) {
    const yes = h("button.btn.danger", { type: "button" }, t("Disconnect"));
    const close = sheet(t("Disconnect account"), h("p", { style: "margin:0" },
      t("Stop watching @{handle} on {platform}? Its saved sign-in is deleted. Comments and leads already found are kept.", { handle: a.handle, platform: PLATFORM[a.platform] || a.platform })), [yes]);
    yes.addEventListener("click", async () => {
      try { await api(`/api/social/accounts/${a.id}`, { method: "DELETE" }); close(); toast(t("Account disconnected.")); await loadAccounts(); }
      catch (err) { toast(err.message, "bad"); }
    });
  }

  async function loadComments() {
    commentsBox.replaceChildren(loading());
    const { comments } = await api("/api/social/comments?limit=50");
    if (!comments.length) { commentsBox.replaceChildren(empty(t("No comments yet."), "social")); return; }
    commentsBox.replaceChildren(h("div.list", comments.map(c => h(c.lead_id ? "a.row" : "div.row", c.lead_id ? { href: "#/leads" } : {},
      h("span.title", `@${String(c.author_handle || c.author_name || t("someone")).replace(/^@/, "")}`),
      c.lead_id ? chip(c.lead_status, t("Lead · {status}", { status: t(LEAD_STATUS[c.lead_status] || c.lead_status) })) : c.triaged ? chip("draft", t("Not a lead")) : chip("queued", t("Checking")),
      h("span.sub", `${PLATFORM[c.platform] || c.platform} · @${c.account_handle} · ${fmtAgo(c.posted_at || c.fetched_at)}`),
      c.lead_id
        ? h("span.sub", { style: "color:var(--mist)" }, c.body)
        : h("div.sub", { style: "color:var(--mist)" }, translatable(c.body)),
    ))));
  }

  async function loadPosts() {
    postsBox.replaceChildren(loading());
    const { posts } = await api("/api/social/posts");
    if (!posts.length) { postsBox.replaceChildren(empty(t("Nothing posted from the Hub yet."), "social", h("button.btn", { type: "button", onclick: () => composer() }, t("New post")))); return; }
    postsBox.replaceChildren(h("div.list", posts.map(p => h("div.row",
      h("span.title", p.caption ? (p.caption.length > 80 ? p.caption.slice(0, 80) + "…" : p.caption) : t("(no caption)")),
      chip(p.status),
      h("span.sub", `${p.media_type?.startsWith("video/") ? t("Video") : t("Photo")} · ${fmtAgo(p.created_at)}`),
      h("div.sub", { style: "display:grid;gap:6px" }, p.targets.map(target => h("div",
        flex(h("span", `${PLATFORM[target.platform] || target.platform} @${target.handle}`), chip(target.status)),
        target.error && target.status !== "published" ? h("small", { style: "color:var(--bad)" }, target.error) : null))),
      ["draft", "failed", "partial", "queued"].includes(p.status)
        ? h("div.sub", h("button.btn.small", { type: "button", onclick: e => publish(p.id, e.currentTarget) }, p.status === "draft" ? t("Publish") : t("Try again")))
        : null,
    ))));
  }

  async function publish(postId, btn) {
    if (btn) btn.disabled = true;
    try {
      const { post } = await api(`/api/social/posts/${postId}/publish`, { method: "POST", body: {} });
      toast(post.status === "published" ? t("Published.") : post.status === "queued" ? t("Publishing: the rest will go out on the next run.") : t("Publishing finished: {status}.", { status: t(POST_STATUS[post.status] || post.status) }), post.status === "failed" ? "bad" : "");
    } catch (err) { toast(err.message, "bad"); }
    await loadPosts();
  }

  function composer() {
    const usable = accounts.filter(a => a.status === "active");
    const file = h("input.input", { type: "file", name: "media", accept: "video/mp4,image/jpeg,image/png" });
    const fileInfo = h("small", t("MP4 video, or a JPEG or PNG photo (Instagram takes JPEG only). Up to 90 MB."));
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      fileInfo.textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
      if (f.size > MAX_MB * 1048576) toast(t("That file is over 90 MB."), "bad");
    });
    const counter = h("small", `0 / ${MAX_CAPTION}`);
    const caption = h("textarea.input", { name: "caption", rows: 5, maxlength: MAX_CAPTION });
    caption.addEventListener("input", () => { counter.textContent = `${caption.value.length} / ${MAX_CAPTION}`; });
    const boxes = usable.map(a => {
      const ok = CAN_PUBLISH.has(a.platform);
      return h("label", { style: "display:flex;gap:10px;align-items:center;min-height:36px" },
        h("input", { type: "checkbox", name: "account_ids", value: a.id, checked: ok, disabled: !ok }),
        h("span", `${PLATFORM[a.platform] || a.platform} · @${a.handle}`, ok ? null : h("small.muted", ` ${t("(posting not supported yet)")}`)));
    });
    const err = errBox();
    const form = h("form.form",
      h("label.field", h("span", t("Video or photo")), file, fileInfo, h("p.err", { hidden: true })),
      h("label.field", h("span", t("Caption")), caption, counter, h("p.err", { hidden: true })),
      h("div.field", h("span", t("Post to")), boxes.length ? h("div", boxes) : h("small", t("Connect an account first."))),
      err,
    );
    const go = h("button.btn.primary", { type: "button", disabled: !usable.some(a => CAN_PUBLISH.has(a.platform)) }, t("Publish"));
    const close = sheet(t("New post"), form, [go]);
    const submit = async e => {
      e?.preventDefault();
      err.hidden = true;
      const f = file.files?.[0];
      if (!f) { err.textContent = t("Choose a video or photo."); err.hidden = false; return; }
      const fd = new FormData();
      fd.append("media", f, f.name);
      fd.append("caption", caption.value);
      for (const cb of form.querySelectorAll('input[name="account_ids"]:checked')) fd.append("account_ids", cb.value);
      go.disabled = true; go.textContent = t("Uploading…");
      try {
        const { post } = await api("/api/social/posts", { method: "POST", body: fd });
        go.textContent = t("Publishing…");
        close();
        await publish(post.id);
      } catch (e2) {
        showFieldErrors(form, e2);
        err.textContent = e2.fields?.account_ids || e2.message;
        err.hidden = false; go.disabled = false; go.textContent = t("Publish");
      }
    };
    form.addEventListener("submit", submit);
    go.addEventListener("click", submit);
  }

  try { await loadAccounts(); } catch (err) { accountsBox.replaceChildren(empty(err.message, "social")); }
  await Promise.all([
    loadPosts().catch(err => postsBox.replaceChildren(empty(err.message, "social"))),
    loadComments().catch(err => commentsBox.replaceChildren(empty(err.message, "social"))),
  ]);
}

const LEAD_STATUS = { new: "New", replied: "Replied", booked: "Booked", dismissed: "Dismissed" };
const POST_STATUS = { draft: "Draft", queued: "Queued", published: "Published", partial: "Partly published", failed: "Failed" };
