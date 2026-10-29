// End-to-end checks for notifications: the inbox, who is told, per-person switches, and real Web Push
// delivery to a mock push service run here (the message is decrypted and the VAPID signature verified).
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, webcrypto as crypto } from "node:crypto";
import { BASE, SITE_ORIGIN, anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("notifications");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- a mock push service ----------
const received = [];
let reply = 201;
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(reply).end(); });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}/push/device-b`;
async function waitForPush(count, ms = 6000) {
  for (let t = 0; t < ms && received.length < count; t += 100) await sleep(100);
  return received.length >= count ? received[count - 1] : null;
}

// The "phone": an ECDH key pair and auth secret, as a browser would make.
const device = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const devicePublic = Buffer.from(await crypto.subtle.exportKey("raw", device.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const b64url = b => Buffer.from(b).toString("base64url");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

async function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], senderPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const senderKey = await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = Buffer.from(await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, device.privateKey, 256));
  const ikm = hmac(hmac(authSecret, ecdh), Buffer.concat([Buffer.from("WebPush: info\0"), devicePublic, senderPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = Buffer.from(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

async function vapidValid(authorization, publicKey) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(authorization || "");
  if (!m || m[4] !== publicKey) return false;
  const key = await crypto.subtle.importKey("raw", Buffer.from(publicKey, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(m[3], "base64url"), Buffer.from(`${m[1]}.${m[2]}`));
  return ok && claims.aud === new URL(endpoint).origin && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub);
}

// ---------- two owners ----------
const callA = await signIn();
const emailB = `owner-b-${Date.now()}@mk.test`, passB = "second-owner-password-123";
execFileSync("node", ["scripts/create-user.mjs", "--email", emailB, "--name", "Kamil Test"], { env: { ...process.env, MK_PASSWORD: passB }, stdio: "ignore" });
const callB = await signIn(emailB, passB);
await callB("/api/auth/lang", { method: "POST", body: { lang: "pl" } });

const inbox = async call => (await call("/api/notifications?limit=50")).data;

let r = await callB("/api/notifications/config");
const publicKey = r.data?.publicKey;
check("the Hub publishes its push key", r.status === 200 && r.data?.push === true && Buffer.from(publicKey || "", "base64url").length === 65, r.data);

r = await callB("/api/notifications/subscriptions", { method: "POST", body: { endpoint: "https://evil.example/push", keys: { p256dh: b64url(devicePublic), auth: b64url(authSecret) } } });
check("a subscription to a non-push host is refused", r.status === 400, r.data);
r = await callB("/api/notifications/subscriptions", { method: "POST", body: { endpoint, keys: { p256dh: "short", auth: b64url(authSecret) } } });
check("a subscription with bad keys is refused", r.status === 400, r.data);
r = await callB("/api/notifications/subscriptions", { method: "POST", body: { endpoint, keys: { p256dh: b64url(devicePublic), auth: b64url(authSecret) } } });
check("owner B turns on notifications for a device", r.status === 201 && r.data?.devices === 1, r.data);
r = await anon("/api/notifications/subscriptions", { method: "POST", body: { endpoint }, headers: { origin: BASE } });
check("subscribing needs a signed-in user", r.status === 401);

// ---------- a new job by A reaches B (inbox + phone), not A ----------
r = await callA("/api/jobs", { method: "POST", body: { title: "Keys and immobiliser · AB12 CDE", reg: "ab12cde" } });
const jobId = r.data?.job?.id;
check("owner A adds a job", r.status === 201 && !!jobId, r.data);
const push1 = await waitForPush(1);
check("a push reaches B's device", !!push1 && push1.url === "/push/device-b");
check("the push uses aes128gcm with a TTL", push1?.headers["content-encoding"] === "aes128gcm" && Number(push1?.headers.ttl) > 0);
check("the push is signed with a valid VAPID JWT", await vapidValid(push1?.headers.authorization, publicKey));
const msg = push1 ? await decrypt(push1.body) : null;
check("the push decrypts on the device, in B's language, linking to the job", msg?.title?.startsWith("Nowe zlecenie J-") && /Klucze i immobilizer/.test(msg?.body || "") && msg?.url === `/app/#/jobs/${jobId}`, msg);
let b = await inbox(callB), a = await inbox(callA);
check("B's inbox has the job, unread", b.unread === 1 && b.notifications[0]?.kind === "job_new" && b.notifications[0]?.link === `#/jobs/${jobId}`, b);
check("A isn't told about their own job", a.unread === 0 && a.notifications.length === 0, a);

// ---------- notes, assignment, status ----------
await callA(`/api/jobs/${jobId}/notes`, { method: "POST", body: { body: "Steering lock clicks, no crank." } });
b = await inbox(callB);
check("a note by A notifies B", b.notifications[0]?.kind === "job_note" && /Steering lock/.test(b.notifications[0]?.body || ""), b.notifications[0]);
const { data: me } = await callB("/api/auth/me");
await callA(`/api/jobs/${jobId}`, { method: "PATCH", body: { assigned_to: me.user.id } });
await callA(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: "in_progress" } });
b = await inbox(callB);
check("assigning the job to B tells B", b.notifications.some(n => n.kind === "job_assigned"), b.notifications.map(n => n.kind));
check("starting the job tells B", b.notifications[0]?.kind === "job_started", b.notifications.map(n => n.kind));
await callB(`/api/jobs/${jobId}`, { method: "PATCH", body: { assigned_to: me.user.id } });
a = await inbox(callA);
check("B assigning a job to themselves tells nobody", a.notifications.every(n => n.kind !== "job_assigned"), a.notifications.map(n => n.kind));

// ---------- website booking reaches both ----------
const before = { a: (await inbox(callA)).unread, b: (await inbox(callB)).unread };
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
r = await anon("/api/public/bookings", { method: "POST", headers: { origin: SITE_ORIGIN }, body: { name: "Web Customer", phone: "07700 900456", reg: "wr70xyz", service: "remap", preferred_date: tomorrow, location: "workshop", website: "" } });
check("a website booking is accepted", r.status === 200, r.data);
a = await inbox(callA); b = await inbox(callB);
check("a website booking tells both owners", a.unread === before.a + 1 && b.unread === before.b + 1 && a.notifications[0]?.kind === "booking_new" && a.notifications[0]?.title.startsWith("New booking CP-"), a.notifications[0]);
check("each owner reads it in their own language", b.notifications[0]?.title.startsWith("Nowa rezerwacja CP-") && /Remap ECU/.test(b.notifications[0]?.body || ""), b.notifications[0]);

// ---------- switches ----------
r = await callB("/api/notifications/prefs", { method: "PUT", body: { prefs: { jobs_notes: false } } });
check("B switches off notes", r.status === 200 && r.data?.prefs?.jobs_notes === false && r.data?.prefs?.jobs_new === true, r.data);
const unreadBefore = (await inbox(callB)).unread;
await callA(`/api/jobs/${jobId}/notes`, { method: "POST", body: { body: "Second note." } });
check("a switched-off group isn't sent", (await inbox(callB)).unread === unreadBefore);
r = await callB("/api/notifications/prefs", { method: "PUT", body: { prefs: { nonsense: true } } });
check("unknown switches are refused", r.status === 400);

// ---------- reading ----------
b = await inbox(callB);
r = await callB("/api/notifications/read", { method: "POST", body: { ids: [b.notifications[0].id] } });
check("marking one as read lowers the count", r.status === 200 && r.data?.unread === b.unread - 1, r.data);
r = await callA("/api/notifications/read", { method: "POST", body: { ids: [b.notifications[1].id] } });
check("you can't mark someone else's notification as read", r.status === 200 && (await inbox(callB)).unread === b.unread - 1);
r = await callB("/api/notifications/read", { method: "POST", body: { all: true } });
check("mark all as read", r.status === 200 && r.data?.unread === 0, r.data);

// ---------- test notification, and a device that's gone ----------
const n = received.length;
r = await callB("/api/notifications/test", { method: "POST", body: {} });
check("a test notification reaches the device", r.status === 200 && r.data?.delivered === 1 && !!(await waitForPush(n + 1)), r.data);
reply = 410;
await callA("/api/jobs", { method: "POST", body: { title: "Diagnostics" } });
await waitForPush(n + 2);
await sleep(500);
r = await callB("/api/notifications/test", { method: "POST", body: {} });
check("a device the push service says is gone (410) is removed", r.data?.devices === 0, r.data);
check("the inbox still works without a device", (await inbox(callB)).notifications[0]?.kind === "test");

r = await callA("/api/notifications/outbox");
check("the customer-message outbox still works", r.status === 200 && Array.isArray(r.data?.messages));

server.close();
done();
