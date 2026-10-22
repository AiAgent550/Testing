// Lists every translatable string in the dashboard and sign-in page: t("..."), tn(n, "..."), N_("...")
// in the JS, and data-i18n="..." in login.html. Used by test/i18n.test.ts and handy when adding a language.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const STR = String.raw`(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\x60((?:\\.|[^\x60\\$])*)\x60)`;
const CALLS = [new RegExp(String.raw`\b(?:t|N_)\(\s*` + STR, "g"), new RegExp(String.raw`\btn\([^,()]+(?:\([^()]*\))?[^,()]*,\s*` + STR, "g")];
const unescape = s => s.replace(/\\(["'\x60\\])/g, "$1").replace(/\\n/g, "\n");

export function collectKeys() {
  const keys = new Map(); // key -> first file it appears in
  const files = walk(ROOT).filter(f => /\.(js|html)$/.test(f) && !/i18n(-pl)?\.js$/.test(f));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of CALLS) for (const m of src.matchAll(re)) {
      const k = unescape(m[1] ?? m[2] ?? m[3]);
      if (!keys.has(k)) keys.set(k, f.slice(ROOT.length));
    }
    for (const m of src.matchAll(/data-i18n="([^"]+)"/g)) if (!keys.has(m[1])) keys.set(m[1], f.slice(ROOT.length));
  }
  return keys;
}

/** Every fixed message the API can send to the dashboard: error helpers, field errors and their field texts.
 *  Platform adapter errors are left out: they are shown as the platform reports them. */
export function serverMessages() {
  const SRC = new URL("../src/", import.meta.url).pathname;
  const out = new Set();
  const call = /\b(?:badRequest|conflict|unauthorized|forbidden|tooMany|notFound)\(\s*"((?:\\.|[^"\\])*)"/g;
  const fieldErr = /FieldError\(f,\s*"((?:\\.|[^"\\])*)"/g;
  const httpErr = /HttpError\(\d+,\s*"[a-z_]+",\s*"((?:\\.|[^"\\])*)"/g;
  const defaults = /(?:message|what) = "((?:\\.|[^"\\])*)"/g;
  const fieldText = /\{\s*[\w[\]]+:\s*"((?:\\.|[^"\\])*)"\s*\}/g; // { phone: "Required." } as badRequest's second argument
  for (const f of walk(SRC).filter(f => f.endsWith(".ts") && !/\/social\/adapters?\//.test(f))) {
    const src = readFileSync(f, "utf8");
    for (const re of [call, fieldErr, httpErr, defaults]) for (const m of src.matchAll(re)) out.add(m[1]);
    for (const line of src.split("\n").filter(l => /badRequest\(/.test(l))) for (const m of line.matchAll(fieldText)) out.add(m[1]);
  }
  return [...out];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { PL } = await import("../public/assets/i18n-pl.js").catch(() => ({ PL: {} }));
  const keys = collectKeys();
  const missing = [...keys].filter(([k]) => !(k in PL));
  if (process.argv.includes("--missing")) for (const [k, f] of missing) console.log(JSON.stringify(k), " // ", f);
  else for (const [k] of keys) console.log(JSON.stringify(k));
  console.error(`${keys.size} keys, ${missing.length} missing in Polish`);
}
