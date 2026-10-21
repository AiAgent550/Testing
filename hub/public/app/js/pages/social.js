// Social: connected accounts, recent public comments, and posting one video/photo to several accounts.
import { api, chip, empty, field, fmtAgo, h, icon, loading, pageHead, sheet, showFieldErrors, toast } from "../core.js";

const PLATFORM = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", google: "Google" };
const CAN_PUBLISH = new Set(["instagram", "facebook"]);
const MAX_CAPTION = 2200, MAX_MB = 200;

const CONNECT_ERRORS = {
  state: "That sign-in link had expired or was already used. Try connecting again.",
  denied: "Connecting was cancelled.",
  code: "The platform didn't send back a sign-in code. Try again.",
  "no-accounts": "No pages or channels were found on that login. Check you picked the business's Page (and its Instagram) when asked.",
  needs_reauth: "The platform didn't grant the permissions the Hub needs. Try again and allow everything it asks for.",
  not_configured: "This platform isn't set up on the Hub yet.",
  not_supported: "That account type isn't supported (for YouTube, the Google account needs a channel).",
  rate_limited: "The platform is busy. Wait a few minutes and try again.",
};

const flex = (...c) => h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, c);
const errBox = () => h("p", { hidden: true, role: "alert", style: "margin:0;color:var(--bad);font-size:14px" });

export async function render(view, { params }) {
  // Back from a Connect button: #/social/connected/<provider> or #/social/error/<provider>-<reason>
  if (params[0] === "connected") toast(`${params[1] === "google" ? "YouTube" : "Instagram and Facebook"} connected.`);
  if (params[0] === "error") {
    const reason = String(params[1] || "").replace(/^(meta|google)-/, "");
    toast(CONNECT_ERRORS[reason] || "Connecting didn't work. Try again.", "bad");
  }
  if (params.length) history.replaceState(null, "", "#/social");

  const accountsBox = h("div.stack"), commentsBox = h("div.stack"), postsBox = h("div.stack");
  const newPostBtn = h("button.btn.primary", { type: "button", onclick: () => composer() }, icon("plus"), "New post");
  view.replaceChildren(
    pageHead("M&K Hub", "Social", newPostBtn),
    h("div.stack",
      h("section.card.stack", h("h2.h2", "Accounts"), accountsBox),
      h("section.card.stack", h("h2.h2", "Posts"), postsBox),
      h("section.card.stack", h("h2.h2", "Recent comments"), commentsBox),
    ),
  );

  let accounts = [], providers = {};

  async function loadAccounts() {
    accountsBox.replaceChildren(loading());
    const data = await api("/api/social/accounts");
    accounts = data.accounts; providers = data.providers;
    const list = accounts.length
      ? h("div.list", accounts.map(a => h("div.row",
        h("span.title", `${PLATFORM[a.platform] || a.platform} · @${a.handle}`),
        flex(
          a.demo ? chip("draft", "Demo") : null,
          a.status === "active" ? chip("confirmed", "Connected") : chip("failed", "Reconnect needed"),
          h("button.btn.small.ghost", { type: "button", onclick: () => disconnect(a) }, "Disconnect"),
        ),
        h("span.sub", a.last_polled_at ? `Comments checked ${fmtAgo(a.last_polled_at)}` : "Not checked yet"),
      )))
      : h("p.muted", { style: "margin:0" }, "No accounts connected yet.");

    const connect = (label, provider, configured, secrets) => configured
      ? h("a.btn", { href: `/api/social/connect/${provider}/start` }, label)
      : h("span", { style: "display:grid;gap:4px" },
        h("button.btn", { type: "button", disabled: true }, label),
        h("small.muted", `Needs ${secrets} in the Hub's settings on Cloudflare.`));
    accountsBox.replaceChildren(
      list,
      flex(
        connect("Connect Instagram & Facebook", "meta", providers.meta?.configured, "META_APP_ID and META_APP_SECRET"),
        connect("Connect YouTube", "google", providers.google?.configured, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"),
        h("span", { style: "display:inline-flex;gap:8px;align-items:center" }, h("button.btn", { type: "button", disabled: true }, "TikTok"), chip("draft", "Coming soon")),
        providers.demo?.available ? h("button.btn.ghost", { type: "button", onclick: addDemo }, "Add demo account") : null,
      ),
      h("p.muted.small", { style: "margin:0" }, "The Hub checks public comments every 10 minutes (not private messages) and flags enquiries on the Leads page."),
    );
  }

  async function addDemo() {
    try { await api("/api/social/accounts/mock", { method: "POST", body: {} }); toast("Demo account added. Use Check now on Leads to load its sample comments."); await loadAccounts(); }
    catch (err) { toast(err.message, "bad"); }
  }

  function disconnect(a) {
    const yes = h("button.btn.danger", { type: "button" }, "Disconnect");
    const close = sheet("Disconnect account", h("p", { style: "margin:0" },
      `Stop watching @${a.handle} on ${PLATFORM[a.platform] || a.platform}? Its saved sign-in is deleted. Comments and leads already found are kept.`), [yes]);
    yes.addEventListener("click", async () => {
      try { await api(`/api/social/accounts/${a.id}`, { method: "DELETE" }); close(); toast("Account disconnected."); await loadAccounts(); }
      catch (err) { toast(err.message, "bad"); }
    });
  }

  async function loadComments() {
    commentsBox.replaceChildren(loading());
    const { comments } = await api("/api/social/comments?limit=50");
    if (!comments.length) { commentsBox.replaceChildren(empty("No comments yet.", "social")); return; }
    commentsBox.replaceChildren(h("div.list", comments.map(c => h(c.lead_id ? "a.row" : "div.row", c.lead_id ? { href: "#/leads" } : {},
      h("span.title", `@${String(c.author_handle || c.author_name || "someone").replace(/^@/, "")}`),
      c.lead_id ? chip(c.lead_status, `Lead · ${c.lead_status}`) : c.triaged ? chip("draft", "Not a lead") : chip("queued", "Checking"),
      h("span.sub", `${PLATFORM[c.platform] || c.platform} · @${c.account_handle} · ${fmtAgo(c.posted_at || c.fetched_at)}`),
      h("span.sub", { style: "color:var(--mist)" }, c.body),
    ))));
  }

  async function loadPosts() {
    postsBox.replaceChildren(loading());
    const { posts } = await api("/api/social/posts");
    if (!posts.length) { postsBox.replaceChildren(empty("Nothing posted from the Hub yet.", "social", h("button.btn", { type: "button", onclick: () => composer() }, "New post"))); return; }
    postsBox.replaceChildren(h("div.list", posts.map(p => h("div.row",
      h("span.title", p.caption ? (p.caption.length > 80 ? p.caption.slice(0, 80) + "…" : p.caption) : "(no caption)"),
      chip(p.status),
      h("span.sub", `${p.media_type?.startsWith("video/") ? "Video" : "Photo"} · ${fmtAgo(p.created_at)}`),
      h("div.sub", { style: "display:grid;gap:6px" }, p.targets.map(t => h("div",
        flex(h("span", `${PLATFORM[t.platform] || t.platform} @${t.handle}`), chip(t.status)),
        t.error && t.status !== "published" ? h("small", { style: "color:var(--bad)" }, t.error) : null))),
      ["draft", "failed", "partial", "queued"].includes(p.status)
        ? h("div.sub", h("button.btn.small", { type: "button", onclick: e => publish(p.id, e.currentTarget) }, p.status === "draft" ? "Publish" : "Try again"))
        : null,
    ))));
  }

  async function publish(postId, btn) {
    if (btn) btn.disabled = true;
    try {
      const { post } = await api(`/api/social/posts/${postId}/publish`, { method: "POST", body: {} });
      toast(post.status === "published" ? "Published." : post.status === "queued" ? "Publishing: the rest will go out on the next run." : `Publishing finished: ${post.status}.`, post.status === "failed" ? "bad" : "");
    } catch (err) { toast(err.message, "bad"); }
    await loadPosts();
  }

  function composer() {
    const usable = accounts.filter(a => a.status === "active");
    const file = h("input.input", { type: "file", name: "media", accept: "video/mp4,image/jpeg,image/png" });
    const fileInfo = h("small", "MP4 video, or a JPEG or PNG photo (Instagram takes JPEG only). Up to 200 MB.");
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      fileInfo.textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
      if (f.size > MAX_MB * 1048576) toast("That file is over 200 MB.", "bad");
    });
    const counter = h("small", `0 / ${MAX_CAPTION}`);
    const caption = h("textarea.input", { name: "caption", rows: 5, maxlength: MAX_CAPTION });
    caption.addEventListener("input", () => { counter.textContent = `${caption.value.length} / ${MAX_CAPTION}`; });
    const boxes = usable.map(a => {
      const ok = CAN_PUBLISH.has(a.platform);
      return h("label", { style: "display:flex;gap:10px;align-items:center;min-height:36px" },
        h("input", { type: "checkbox", name: "account_ids", value: a.id, checked: ok, disabled: !ok }),
        h("span", `${PLATFORM[a.platform] || a.platform} · @${a.handle}`, ok ? null : h("small.muted", " (posting not supported yet)")));
    });
    const err = errBox();
    const form = h("form.form",
      h("label.field", h("span", "Video or photo"), file, fileInfo, h("p.err", { hidden: true })),
      h("label.field", h("span", "Caption"), caption, counter, h("p.err", { hidden: true })),
      h("div.field", h("span", "Post to"), boxes.length ? h("div", boxes) : h("small", "Connect an account first.")),
      err,
    );
    const go = h("button.btn.primary", { type: "button", disabled: !usable.some(a => CAN_PUBLISH.has(a.platform)) }, "Publish");
    const close = sheet("New post", form, [go]);
    const submit = async e => {
      e?.preventDefault();
      err.hidden = true;
      const f = file.files?.[0];
      if (!f) { err.textContent = "Choose a video or photo."; err.hidden = false; return; }
      const fd = new FormData();
      fd.append("media", f, f.name);
      fd.append("caption", caption.value);
      for (const cb of form.querySelectorAll('input[name="account_ids"]:checked')) fd.append("account_ids", cb.value);
      go.disabled = true; go.textContent = "Uploading…";
      try {
        const { post } = await api("/api/social/posts", { method: "POST", body: fd });
        go.textContent = "Publishing…";
        close();
        await publish(post.id);
      } catch (e2) {
        showFieldErrors(form, e2);
        err.textContent = e2.fields?.account_ids || e2.message;
        err.hidden = false; go.disabled = false; go.textContent = "Publish";
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
