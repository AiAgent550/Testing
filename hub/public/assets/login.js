// Sign-in flow: password -> (first time) authenticator setup -> 6-digit code -> dashboard.
// An invite link (/login#invite=<token>) starts with "create your account" instead of the password step.
// The EN | PL switch is remembered on this device; once signed in, the account's own language wins.
import { deviceLang, getLang, rememberLang, setLang, t, tServer } from "./i18n.js";

const $ = id => document.getElementById(id);

function applyLang(lang) {
  setLang(lang);
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const b of document.querySelectorAll(".lang-switch button")) b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  document.title = `${t("Sign in")} · Curve Hub`;
  // Error messages already on screen were written in the previous language: clear them.
  for (const el of document.querySelectorAll(".err")) el.hidden = true;
}

for (const b of document.querySelectorAll(".lang-switch button")) {
  b.addEventListener("click", () => { rememberLang(b.dataset.lang); applyLang(b.dataset.lang); });
}

async function call(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const field = Object.values(data?.error?.fields || {})[0];
    throw new Error(tServer(field && data?.error?.code === "bad_request" ? field : data?.error?.message) || t("Something went wrong. Try again."));
  }
  return data;
}

function show(step) {
  for (const id of ["step-password", "step-invite", "step-setup", "step-totp"]) $(id).hidden = id !== step;
  const first = $(step).querySelector("input:not([readonly])");
  if (first) first.focus();
}

function fail(id, message) { const el = $(id); el.textContent = message; el.hidden = false; }
function busy(form, on) { const b = form.querySelector("button[type=submit]"); b.disabled = on; }

/** After the password step, show the rest in the account's own language. */
async function useAccountLang() {
  try {
    const me = await call("/api/auth/me");
    if (me.lang && me.lang !== getLang()) { rememberLang(me.lang); applyLang(me.lang); }
    return me;
  } catch { return null; }
}

async function startSetup() {
  const { secret, otpauth } = await call("/api/auth/totp/setup");
  $("secret").textContent = secret.replace(/(.{4})/g, "$1 ").trim();
  $("otpauth").href = otpauth;
  show("step-setup");
}

const inviteToken = (location.hash.match(/^#invite=([0-9a-f]{64})$/) || [])[1];

async function startInvite() {
  try {
    const { email } = await call("/api/auth/invite/check", "POST", { token: inviteToken });
    $("invite-email").value = email;
    show("step-invite");
  } catch (err) {
    history.replaceState(null, "", "/login");
    show("step-password");
    fail("err-password", err.message);
  }
}

$("step-invite").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget; $("err-invite").hidden = true;
  const name = $("invite-name").value.trim(), password = $("invite-password").value;
  if (!name) return fail("err-invite", t("Enter your name."));
  if (password.trim().length < 12) return fail("err-invite", t("Use at least 12 characters for your password."));
  if (password !== $("invite-password2").value) return fail("err-invite", t("The two passwords don't match."));
  busy(form, true);
  try {
    // The language chosen here becomes the new account's language.
    await call("/api/auth/invite", "POST", { token: inviteToken, name, password, lang: getLang() });
    history.replaceState(null, "", "/login");
    await startSetup();
  } catch (err) { fail("err-invite", err.message); }
  finally { busy(form, false); }
});

async function resume() {
  // Already part-way signed in (password done)? Carry on from the right step.
  try {
    const me = await call("/api/auth/me");
    if (me.lang && me.lang !== getLang()) applyLang(me.lang);
    if (me.mfa_ok) return location.replace("/app/");
    if (me.totp_enabled) show("step-totp"); else await startSetup();
  } catch { show("step-password"); }
}

$("step-password").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget; $("err-password").hidden = true; busy(form, true);
  try {
    const { next } = await call("/api/auth/login", "POST", { email: $("email").value, password: $("password").value });
    await useAccountLang();
    if (next === "setup") await startSetup(); else show("step-totp");
  } catch (err) { fail("err-password", err.message); }
  finally { busy(form, false); }
});

for (const [formId, inputId, errId] of [["step-setup", "setup-code", "err-setup"], ["step-totp", "code", "err-totp"]]) {
  $(formId).addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget; $(errId).hidden = true; busy(form, true);
    try {
      await call("/api/auth/totp", "POST", { code: $(inputId).value.replace(/\s/g, "") });
      location.replace("/app/");
    } catch (err) { fail(errId, err.message); }
    finally { busy(form, false); }
  });
}

applyLang(deviceLang());
if (inviteToken) startInvite(); else resume();
