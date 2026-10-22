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
