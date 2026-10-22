// Creates a one-time invite link for a new Hub user. Usage:
//   node scripts/invite.mjs --email someone@example.com [--hours 72] [--remote]
// Prints the link once. Only the token's SHA-256 is stored, so a leaked database can't be used to sign up.
// The person opens the link, chooses their own name and password, then sets up two-step sign-in.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const email = String(args.email || "").trim().toLowerCase();
const hours = Math.min(Math.max(Number(args.hours) || 72, 1), 24 * 14);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Give --email."); process.exit(1); }

const token = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(token).digest("hex");
const now = new Date(), expires = new Date(now.getTime() + hours * 3600e3);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO invites (token_hash, email, created_at, expires_at) VALUES (${q(hash)}, ${q(email)}, ${q(now.toISOString())}, ${q(expires.toISOString())});`;
execFileSync("npx", ["wrangler", "d1", "execute", "curve-hub", args.remote ? "--remote" : "--local", "--command", sql], { stdio: ["ignore", "ignore", "inherit"] });

const origin = args.remote ? "https://hub.curveperformance.co.uk" : (process.env.HUB_URL || "http://localhost:8787");
if (args.json) console.log(JSON.stringify({ email, link: `${origin}/login#invite=${token}`, token, expires: expires.toISOString() }));
else console.log(`Invite for ${email} (valid until ${expires.toUTCString()}):\n${origin}/login#invite=${token}`);
