// Sign-in flow: password -> (first time) authenticator setup -> 6-digit code -> dashboard.
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
  for (const id of ["step-password", "step-setup", "step-totp"]) $(id).hidden = id !== step;
  const first = $(step).querySelector("input");
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

resume();
