// End-to-end checks for languages: the per-user language setting, Polish tool suggestions,
// and the translate endpoint when AI isn't connected (it isn't in local runs).
import { checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("i18n");
const call = await signIn();

let r = await call("/api/auth/me");
check("a user starts in English", r.status === 200 && r.data?.lang === "en" && r.data?.user?.lang === "en", r.data);

r = await call("/api/auth/lang", { method: "POST", body: { lang: "de" } });
check("an unsupported language is refused", r.status === 400 && !!r.data?.error?.fields?.lang, r.data);

r = await call("/api/auth/lang", { method: "POST", body: { lang: "pl" } });
check("the language can be switched to Polish", r.status === 200 && r.data?.lang === "pl", r.data);
r = await call("/api/auth/me");
check("the account remembers Polish", r.data?.lang === "pl", r.data);

r = await call("/api/system/audit?limit=20");
const audited = (r.data?.entries || r.data?.audit || r.data?.rows || []).some(e => e.action === "auth.lang_changed");
check("the language change is audited", r.status === 200 && audited, r.data);

r = await call("/api/jobs", { method: "POST", body: { title: "All keys lost", description: "No keys at all, steering lock clicks." } });
const jobId = r.data?.job?.id;
check("a job can be created", (r.status === 200 || r.status === 201) && !!jobId, r.data);
r = await call(`/api/ai/jobs/${jobId}/suggest`, { method: "POST" });
const s = r.data?.suggestion;
check("rules suggestions come back in Polish for a Polish user", r.status === 200 && /^Wygląda na: utrata wszystkich kluczy/.test(s?.summary || "") && s?.steps?.some(x => /kopi/.test(x)), s);

r = await call("/api/ai/translate", { method: "POST", body: { text: "Car won't start, all keys lost." } });
check("translate explains that AI isn't connected yet", r.status === 503 && r.data?.error?.code === "ai_unavailable", r.data);
r = await call("/api/ai/translate", { method: "POST", body: { text: "" } });
check("translate needs some text", r.status === 400, r.data);

r = await call("/api/auth/lang", { method: "POST", body: { lang: "en" } });
check("the language can be switched back to English", r.status === 200 && r.data?.lang === "en", r.data);

done();
