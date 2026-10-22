// Settings: account security, connected services and business details.
import { api, chip, field, fmtAgo, h, pageHead, showFieldErrors, toast } from "../core.js";

export async function render(view) {
  const [{ integrations }, { sessions }, me, business, hours] = await Promise.all([
    api("/api/system/integrations"), api("/api/auth/sessions"), api("/api/auth/me"),
    api("/api/settings/business"), api("/api/settings/hours"),
  ]);

  // ---- business details ----
  const biz = business.value;
  const bizForm = h("form.form",
    h("div.form-row",
      field("Business name", h("input.input", { name: "name", value: biz.name || "" })),
      field("Phone", h("input.input", { name: "phone", value: biz.phone || "", inputmode: "tel" })),
    ),
    h("div.form-row",
      field("Email", h("input.input", { name: "email", value: biz.email || "", type: "email" })),
      field("Instagram", h("input.input", { name: "instagram", value: biz.instagram || "" })),
    ),
    field("Address", h("textarea.input", { name: "address", rows: 3 }, biz.address || "")),
    h("div", h("button.btn.primary", { type: "submit" }, "Save details")),
  );
  bizForm.addEventListener("submit", async e => {
    e.preventDefault();
    const value = Object.fromEntries(new FormData(bizForm));
    try { await api("/api/settings/business", { method: "PUT", body: { value } }); toast("Business details saved."); }
    catch (err) { toast(err.message, "bad"); }
  });

  // ---- opening hours ----
  const days = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  const hoursForm = h("form.form",
    h("div.form-row", days.map(([k, label]) => field(label, h("input.input", { name: k, value: hours.value[k] || "", placeholder: "Closed" }), "e.g. 08:00-18:00"))),
    h("div", h("button.btn.primary", { type: "submit" }, "Save hours")),
  );
  hoursForm.addEventListener("submit", async e => {
    e.preventDefault();
    try { await api("/api/settings/hours", { method: "PUT", body: { value: Object.fromEntries(new FormData(hoursForm)) } }); toast("Opening hours saved."); }
    catch (err) { toast(err.message, "bad"); }
  });

  // ---- password ----
  const pwForm = h("form.form",
    field("Current password", h("input.input", { name: "current", type: "password", autocomplete: "current-password" })),
    field("New password", h("input.input", { name: "next", type: "password", autocomplete: "new-password", minlength: 12 }), "At least 12 characters. A short sentence works well."),
    h("div", h("button.btn", { type: "submit" }, "Change password")),
  );
  pwForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/auth/password", { method: "POST", body: Object.fromEntries(new FormData(pwForm)) });
      pwForm.reset(); showFieldErrors(pwForm, null); toast("Password changed. Other devices were signed out.");
    } catch (err) { showFieldErrors(pwForm, err); toast(err.message, "bad"); }
  });

  const everywhere = h("button.btn.danger", { type: "button", onclick: async () => {
    await api("/api/auth/logout-everywhere", { method: "POST" });
    location.href = "/login";
  } }, "Sign out on every device");

  view.replaceChildren(
    pageHead("Curve Hub", "Settings"),
    h("div.stack",
      h("section.card.stack",
        h("h2.h2", "Your account"),
        h("dl.kv", h("dt", "Name"), h("dd", me.user.name), h("dt", "Email"), h("dd", me.user.email),
          h("dt", "Two-step sign-in"), h("dd", chip(me.totp_enabled ? "confirmed" : "failed", me.totp_enabled ? "On" : "Off"))),
        pwForm,
      ),
      h("section.card.stack",
        h("h2.h2", "Signed-in devices"),
        h("div.list", sessions.map(s => h("div.row",
          h("span.title", deviceName(s.user_agent)), s.current ? chip("confirmed", "This device") : h("span.muted.small", fmtAgo(s.last_seen_at)),
          h("span.sub", `Signed in ${fmtAgo(s.created_at)}`)))),
        h("div", everywhere),
      ),
      h("section.card.stack",
        h("h2.h2", "Connected services"),
        h("div.list", integrations.map(i => h("div.row", h("span.title", i.label), chip(i.connected ? "confirmed" : "draft", i.connected ? "Connected" : "Not connected")))),
        h("p.muted.small", { style: "margin:0" }, "Services are connected by adding their keys to the Hub's secure settings on Cloudflare. Features that need a service keep working in a simpler way until it's connected."),
      ),
      h("section.card.stack", h("h2.h2", "Business details"), bizForm),
      h("section.card.stack", h("h2.h2", "Opening hours"), hoursForm),
    ),
  );
}

function deviceName(ua = "") {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Browser";
}
