// Creates a Hub user. Usage:
//   MK_PASSWORD='a long passphrase' node scripts/create-user.mjs --email you@mkautoservices.co.uk --name "Your Name" [--remote]
// The password is read from MK_PASSWORD so it never appears in shell history or process lists.
// Two-step verification is set up by the user on first sign-in.
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const email = String(args.email || "").trim().toLowerCase();
const name = String(args.name || "").trim();
const password = process.env.MK_PASSWORD || "";
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) { console.error("Give --email and --name."); process.exit(1); }
if (password.length < 12) { console.error("Set MK_PASSWORD to at least 12 characters."); process.exit(1); }

const b64 = buf => Buffer.from(buf).toString("base64");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
const hash = `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
let t = Date.now(), time = "";
for (let i = 0; i < 10; i++) { time = alphabet[t % 32] + time; t = Math.floor(t / 32); }
const rand = [...crypto.getRandomValues(new Uint8Array(12))].map(b => alphabet[b % 32]).join("");
const id = `usr_${time}${rand}`;
const now = new Date().toISOString();
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (id, email, name, password_hash, totp_enabled, created_at, updated_at) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(hash)}, 0, ${q(now)}, ${q(now)});`;

execFileSync("npx", ["wrangler", "d1", "execute", "mk-hub", args.remote ? "--remote" : "--local", "--command", sql], { stdio: "inherit" });
console.log(`Created ${name} <${email}>. They set up two-step verification on first sign-in.`);
