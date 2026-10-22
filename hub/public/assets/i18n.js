// Translations for the dashboard and sign-in page. English is the source text and the key:
// t("Bookings") returns the Polish entry when the language is Polish, or the English text when
// there isn't one. test/i18n.test.ts checks that every t()/tn()/N_() string has a Polish entry.
import { PL, PL_PATTERNS } from "./i18n-pl.js";

export const LANGS = ["en", "pl"];
let lang = "en";

export const getLang = () => lang;
export const locale = () => (lang === "pl" ? "pl-PL" : "en-GB");

export function setLang(next) {
  lang = next === "pl" ? "pl" : "en";
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  return lang;
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/** Translates English text. `vars` fills {placeholders}. */
export function t(text, vars) {
  const pl = lang === "pl" ? PL[text] : undefined;
  return fill(typeof pl === "string" ? pl : text, vars);
}

/** Marks a string for translation without translating it yet (for constants built before the language is known). */
export const N_ = text => text;

/** Plural forms. `forms` is the English "one|other" text, e.g. tn(n, "{n} booking|{n} bookings"). */
export function tn(n, forms, vars = {}) {
  const all = { n, ...vars };
  const entry = lang === "pl" ? PL[forms] : undefined;
  if (entry && typeof entry === "object") {
    const rule = new Intl.PluralRules("pl-PL").select(n);
    return fill(entry[rule] ?? entry.other, all);
  }
  const [one, other = one] = forms.split("|");
  return fill(n === 1 ? one : other, all);
}

/** Translates a message that came from the server (errors, field messages), falling back to English. */
export function tServer(message) {
  if (lang !== "pl" || !message) return message;
  const msg = String(message);
  if (typeof PL[msg] === "string") return PL[msg];
  for (const [re, out] of PL_PATTERNS) {
    const m = msg.match(re);
    if (m) return out.replace(/\$(\d)/g, (_, i) => (typeof PL[m[i]] === "string" ? PL[m[i]] : m[i] ?? ""));
  }
  return msg;
}

/** Language saved on this device for the sign-in page (before we know the account's language). */
export function deviceLang() {
  try {
    const saved = localStorage.getItem("curve-hub-lang");
    if (saved === "pl" || saved === "en") return saved;
  } catch {}
  return /^pl\b/i.test(navigator.language || "") ? "pl" : "en";
}

export function rememberLang(l) {
  try { localStorage.setItem("curve-hub-lang", l); } catch {}
}
