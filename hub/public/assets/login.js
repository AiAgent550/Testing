// Sign-in flow: password -> (first time) authenticator setup -> 6-digit code -> dashboard.
// An invite link (/login#invite=<token>) starts with "create your account" instead of the password step.
const $ = id => document.getElementById(id);

async function call(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "Something went wrong. Try again.");
  return data;
}

function show(step) {
  for (const id of ["step-password", "step-invite", "step-setup", "step-totp"]) $(id).hidden = id !== step;
  const first = $(step).querySelector("input:not([readonly])");
  if (first) first.focus();
}

function fail(id, message) { const el = $(id); el.textContent = message; el.hidden = false; }
function busy(form, on) { const b = form.querySelector("button[type=submit]"); b.disabled = on; }

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
  if (!name) return fail("err-invite", "Enter your name.");
  if (password.trim().length < 12) return fail("err-invite", "Use at least 12 characters for your password.");
  if (password !== $("invite-password2").value) return fail("err-invite", "The two passwords don't match.");
  busy(form, true);
  try {
    await call("/api/auth/invite", "POST", { token: inviteToken, name, password });
    history.replaceState(null, "", "/login");
    await startSetup();
  } catch (err) { fail("err-invite", err.message); }
  finally { busy(form, false); }
});

async function resume() {
  // Already part-way signed in (password done)? Carry on from the right step.
  try {
    const me = await call("/api/auth/me");
    if (me.mfa_ok) return location.replace("/app/");
    if (me.totp_enabled) show("step-totp"); else await startSetup();
  } catch { show("step-password"); }
}

$("step-password").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget; $("err-password").hidden = true; busy(form, true);
  try {
    const { next } = await call("/api/auth/login", "POST", { email: $("email").value, password: $("password").value });
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

if (inviteToken) startInvite(); else resume();
