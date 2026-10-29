// Settings: language, account security, connected services and business details.
import { N_, api, chip, field, fmtAgo, getLang, h, pageHead, segmented, showFieldErrors, t, toast } from "../core.js";

// Service names sent by /api/system/integrations, listed so they get Polish entries.
N_("Encryption key"); N_("DVLA vehicle lookup"); N_("DVSA MOT history"); N_("Claude AI"); N_("Instagram and Facebook");

export async function render(view) {
  const [{ integrations }, { sessions }, me, business, hours] = await Promise.all([
    api("/api/system/integrations"), api("/api/auth/sessions"), api("/api/auth/me"),
    api("/api/settings/business"), api("/api/settings/hours"),
  ]);

  // ---- language ----
  const langPick = segmented([["en", "English"], ["pl", "Polski"]], getLang(), async lang => {
    try {
      await api("/api/auth/lang", { method: "POST", body: { lang } });
      try { localStorage.setItem("curve-hub-lang", lang); } catch {}
      location.reload();
    } catch (err) { toast(err.message, "bad"); }
  });

  // ---- business details ----
  const biz = business.value;
  const bizForm = h("form.form",
    h("div.form-row",
      field(t("Business name"), h("input.input", { name: "name", value: biz.name || "" })),
      field(t("Phone"), h("input.input", { name: "phone", value: biz.phone || "", inputmode: "tel" })),
    ),
    h("div.form-row",
      field(t("Email"), h("input.input", { name: "email", value: biz.email || "", type: "email" })),
      field("Instagram", h("input.input", { name: "instagram", value: biz.instagram || "" })),
    ),
    field(t("Address"), h("textarea.input", { name: "address", rows: 3 }, biz.address || "")),
    h("div", h("button.btn.primary", { type: "submit" }, t("Save details"))),
  );
  bizForm.addEventListener("submit", async e => {
    e.preventDefault();
    const value = Object.fromEntries(new FormData(bizForm));
    try { await api("/api/settings/business", { method: "PUT", body: { value } }); toast(t("Business details saved.")); }
    catch (err) { toast(err.message, "bad"); }
  });

  // ---- opening hours ----
  const days = [["mon", t("Monday")], ["tue", t("Tuesday")], ["wed", t("Wednesday")], ["thu", t("Thursday")], ["fri", t("Friday")], ["sat", t("Saturday")], ["sun", t("Sunday")]];
  const hoursForm = h("form.form",
    h("div.form-row", days.map(([k, label]) => field(label, h("input.input", { name: k, value: hours.value[k] || "", placeholder: t("Closed") }), t("e.g. 08:00-18:00")))),
    h("div", h("button.btn.primary", { type: "submit" }, t("Save hours"))),
  );
  hoursForm.addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("/api/settings/hours", { method: "PUT", body: { value: Object.fromEntries(new FormData(hoursForm)) } }); toast(t("Opening hours saved.")); }
    catch (err) { toast(err.message, "bad"); }
  });

  // ---- password ----
  const pwForm = h("form.form",
    field(t("Current password"), h("input.input", { name: "current", type: "password", autocomplete: "current-password" })),
    field(t("New password"), h("input.input", { name: "next", type: "password", autocomplete: "new-password", minlength: 12 }), t("At least 12 characters. A short sentence works well.")),
    h("div", h("button.btn", { type: "submit" }, t("Change password"))),
  );
  pwForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/auth/password", { method: "POST", body: Object.fromEntries(new FormData(pwForm)) });
      pwForm.reset(); showFieldErrors(pwForm, null); toast(t("Password changed. Other devices were signed out."));
    } catch (err) { showFieldErrors(pwForm, err); toast(err.message, "bad"); }
  });

  const everywhere = h("button.btn.danger", { type: "button", onclick: async () => {
    await api("/api/auth/logout-everywhere", { method: "POST" });
    location.href = "/login";
  } }, t("Sign out on every device"));

  view.replaceChildren(
    pageHead("Curve Hub", t("Settings")),
    h("div.stack",
      h("section.card.stack",
        h("h2.h2", "Language / Język"),
        langPick.el,
        h("p.muted.small", { style: "margin:0" }, t("Changes the Hub and AI tool suggestions for you only.")),
      ),
      await notificationsCard(),
      h("section.card.stack",
        h("h2.h2", t("Your account")),
        h("dl.kv", h("dt", t("Name")), h("dd", me.user.name), h("dt", t("Email")), h("dd", me.user.email),
          h("dt", t("Two-step sign-in")), h("dd", chip(me.totp_enabled ? "confirmed" : "failed", me.totp_enabled ? t("On") : t("Off")))),
        pwForm,
      ),
      h("section.card.stack",
        h("h2.h2", t("Signed-in devices")),
        h("div.list", sessions.map(s => h("div.row",
          h("span.title", deviceName(s.user_agent)), s.current ? chip("confirmed", t("This device")) : h("span.muted.small", fmtAgo(s.last_seen_at)),
          h("span.sub", t("Signed in {when}", { when: fmtAgo(s.created_at) }))))),
        h("div", everywhere),
      ),
      h("section.card.stack",
        h("h2.h2", t("Connected services")),
        h("div.list", integrations.map(i => h("div.row", h("span.title", t(i.label)), chip(i.connected ? "confirmed" : "draft", i.connected ? t("Connected") : t("Not connected"))))),
        h("p.muted.small", { style: "margin:0" }, t("Services are connected by adding their keys to the Hub's secure settings on Cloudflare. Features that need a service keep working in a simpler way until it's connected.")),
      ),
      h("section.card.stack", h("h2.h2", t("Business details")), bizForm),
      h("section.card.stack", h("h2.h2", t("Opening hours")), hoursForm),
    ),
  );
}

function deviceName(ua = "") {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return t("Android phone");
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return t("Windows PC");
  return t("Browser");
}

// ---------- notifications ----------
const GROUPS = [
  ["bookings_new", N_("New bookings")],
  ["bookings_changes", N_("Bookings confirmed, moved or cancelled")],
  ["jobs_new", N_("New jobs")],
  ["jobs_assigned", N_("Jobs assigned to me")],
  ["jobs_status", N_("Jobs started, completed or cancelled")],
  ["jobs_notes", N_("Notes added to jobs")],
  ["leads", N_("New leads from social media")],
  ["social", N_("Social posts that didn't publish")],
];

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function notificationsCard() {
  const [{ publicKey, push }, { prefs }] = await Promise.all([api("/api/notifications/config"), api("/api/notifications/prefs")]);
  const state = h("div.stack", { style: "gap:12px" });
  const card = h("section.card.stack",
    h("h2.h2", t("Notifications")),
    h("p.muted.small", { style: "margin:0" }, t("Get a notification on your phone when something happens, even when the Hub is closed. Everything also shows under the bell at the top.")),
    state,
    h("h3.kicker", { style: "margin-top:6px" }, t("Tell me about")),
    h("div.switches", GROUPS.map(([key, label]) => {
      const input = h("input", { type: "checkbox", checked: prefs[key] !== false, "aria-label": t(label) });
      input.addEventListener("change", async () => {
        try { await api("/api/notifications/prefs", { method: "PUT", body: { prefs: { [key]: input.checked } } }); }
        catch (err) { input.checked = !input.checked; toast(err.message, "bad"); }
      });
      return h("label.switch", h("span", t(label)), input);
    })),
    h("p.muted.small", { style: "margin:0" }, t("These choices apply to the bell and to your phone. You're never notified about things you did yourself.")),
  );

  async function turnOn(btn) {
    btn.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { await draw(); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = b64urlBytes(publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== key.join()) { await sub.unsubscribe(); sub = null; }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("/api/notifications/subscriptions", { method: "POST", body: sub.toJSON() });
      toast(t("Notifications are on for this device."));
    } catch (err) {
      toast(err.message || t("Notifications couldn't be turned on."), "bad");
    }
    await draw();
  }

  async function turnOff(btn) {
    btn.disabled = true;
    try {
      const sub = await currentSubscription();
      if (sub) {
        await api("/api/notifications/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      toast(t("Notifications are off for this device."));
    } catch (err) { toast(err.message, "bad"); }
    await draw();
  }

  async function sendTest(btn) {
    btn.disabled = true;
    try {
      const r = await api("/api/notifications/test", { method: "POST", body: {} });
      toast(r.delivered ? t("Test sent. It should appear in a few seconds.") : t("Test added under the bell. No phone accepted it, so turn notifications on for this device first."));
    } catch (err) { toast(err.message, "bad"); }
    btn.disabled = false;
  }

  async function draw() {
    const parts = [];
    if (!pushSupported()) {
      parts.push(h("div", chip("draft", t("Not available here"))));
      if (isIOS() && !isStandalone()) {
        parts.push(h("p.hint", t("On iPhone, notifications only work in the installed app: tap Share, then Add to Home Screen, open Curve Hub from your home screen and turn notifications on here. Needs iOS 16.4 or later.")));
      } else {
        parts.push(h("p.muted.small", { style: "margin:0" }, t("This browser can't receive notifications. Try Chrome on Android, or the installed app on iPhone.")));
      }
    } else if (!push) {
      parts.push(h("div", chip("draft", t("Not set up yet"))));
      parts.push(h("p.muted.small", { style: "margin:0" }, t("Phone notifications need the Hub's notification keys on Cloudflare. The bell still works.")));
    } else if (Notification.permission === "denied") {
      parts.push(h("div", chip("failed", t("Blocked in this browser"))));
      parts.push(h("p.hint", t("Notifications are blocked for this site. Allow them in your browser or phone settings for hub.curveperformance.co.uk, then come back here.")));
    } else {
      const sub = await currentSubscription();
      if (sub && Notification.permission === "granted") {
        const off = h("button.btn.small.ghost", { type: "button" }, t("Turn off on this device"));
        off.addEventListener("click", () => turnOff(off));
        const test = h("button.btn.small", { type: "button" }, t("Send a test notification"));
        test.addEventListener("click", () => sendTest(test));
        parts.push(h("div", chip("confirmed", t("On for this device"))), h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, test, off));
      } else {
        const on = h("button.btn.primary", { type: "button" }, t("Turn on notifications on this device"));
        on.addEventListener("click", () => turnOn(on));
        parts.push(h("div", chip("draft", t("Off for this device"))), h("div", on));
        if (isIOS() && !isStandalone()) parts.push(h("p.hint", t("On iPhone, notifications only work in the installed app: tap Share, then Add to Home Screen, open Curve Hub from your home screen and turn notifications on here. Needs iOS 16.4 or later.")));
      }
    }
    state.replaceChildren(parts);
  }

  await draw();
  return card;
}
