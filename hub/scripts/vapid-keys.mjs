// Generates a VAPID key pair for phone notifications (Web Push). Usage:
//   node scripts/vapid-keys.mjs          prints the keys and the commands to store them on Cloudflare
//   node scripts/vapid-keys.mjs --env    prints KEY=value lines for .dev.vars (local development)
// Never commit the private key. Changing the keys means every device has to turn notifications on again.
import { webcrypto as crypto } from "node:crypto";

const b64url = buf => Buffer.from(buf).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

if (process.argv.includes("--env")) {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
} else {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
  console.log("Store them as Worker secrets (paste each value when asked):");
  console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
  console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
}
