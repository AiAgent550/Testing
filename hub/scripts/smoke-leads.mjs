// End-to-end checks for social comments -> leads -> reply/book, and posting (stage 4).
// Runs against a local Hub, where the demo (mock) Instagram account is available.
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("leads");
const call = await signIn();

// Business phone set, so new leads queue a WhatsApp alert to the owner.
let r = await call("/api/settings/business", { method: "PUT", body: { value: { name: "M&K Auto Services", phone: "07700 900123" } } });
check("business phone saved for lead alerts", r.status === 200, r.data);

r = await anon("/api/leads");
check("leads API refuses anonymous requests", r.status === 401);
r = await anon("/api/social/accounts/mock", { method: "POST", body: {} });
check("demo account route refuses anonymous requests", r.status === 401);

r = await call("/api/social/accounts/mock", { method: "POST", body: {} });
check("demo Instagram account can be added locally", r.status === 201 && r.data?.account?.platform === "instagram" && r.data.account.demo === true, r.data);
const accountId = r.data?.account?.id;
r = await call("/api/social/accounts/mock", { method: "POST", body: {} });
check("adding the demo account twice keeps one account", r.status === 201 && r.data?.account?.id === accountId);

r = await call("/api/social/accounts");
check("accounts list shows the demo account without its token", r.status === 200 && r.data.accounts.some(a => a.id === accountId) && !JSON.stringify(r.data).includes("token_enc"), r.data);
check("accounts list reports provider set-up", typeof r.data?.providers?.meta?.configured === "boolean" && r.data?.providers?.demo?.available === true);

r = await call("/api/social/poll", { method: "POST", body: {} });
check("poll stores the new comments (own reply skipped)", r.status === 200 && r.data?.new_comments === 6, r.data);
check("poll turns the real enquiries into leads", r.data?.new_leads === 3, r.data);

r = await call("/api/social/poll", { method: "POST", body: {} });
check("second poll creates no duplicates", r.status === 200 && r.data?.new_comments === 0 && r.data?.new_leads === 0, r.data);

r = await call("/api/social/comments");
const comments = r.data?.comments || [];
check("recent comments include non-leads for review", r.status === 200 && comments.length === 6 && comments.some(c => c.body === "nice car" && !c.lead_id), r.data);
check("the business's own reply isn't stored", !comments.some(c => c.body.startsWith("Thanks Jay")));

r = await call("/api/leads?status=new");
const leads = r.data?.leads || [];
const bodies = leads.map(l => l.comment_body);
check("new leads listed with comment, platform and account", r.status === 200 && leads.length === 3 && leads.every(l => l.platform === "instagram" && l.account_handle === "mk_auto_demo"), r.data);
check("the A45 remap, lost keys and Golf keys comments are leads",
  bodies.some(b => /A45/.test(b)) && bodies.some(b => /lost both keys/.test(b)) && bodies.some(b => /Golf/.test(b)), bodies);
check("'nice car', '🔥🔥' and 'scam' are not leads", !bodies.some(b => ["nice car", "🔥🔥", "scam"].includes(b)), bodies);
check("leads carry a score and a drafted reply", leads.every(l => l.score >= 50 && l.score <= 100 && (l.suggested_reply || "").length > 10));
r = await call("/api/leads?status=bogus");
check("unknown status filter is refused", r.status === 400);

r = await call("/api/notifications/outbox");
check("owner is alerted about each new lead", (r.data?.messages || []).filter(m => m.template === "lead.new" && m.channel === "whatsapp" && m.to_addr === "+447700900123").length === 3, r.data);

const [l1, l2, l3] = leads;
r = await call(`/api/leads/${l1.id}`, { method: "PATCH", body: { suggested_reply: "Hi! Send us your reg and book in through our website." } });
check("suggested reply can be edited", r.status === 200 && r.data?.lead?.suggested_reply === "Hi! Send us your reg and book in through our website.", r.data);
r = await call(`/api/leads/${l1.id}`, { method: "PATCH", body: { status: "replied" } });
check("PATCH can't set arbitrary statuses", r.status === 400);
r = await call(`/api/leads/${l1.id}/reply`, { method: "POST", body: { text: "x".repeat(1001) } });
check("replies over 1000 characters are refused", r.status === 400 && !!r.data?.error?.fields?.text);
r = await call(`/api/leads/${l1.id}/reply`, { method: "POST", body: { text: "Hi! Send us your reg and book in through our website." }, headers: { origin: "https://evil.example" } });
check("reply from another website is blocked", r.status === 403);
r = await call(`/api/leads/${l1.id}/reply`, { method: "POST", body: { text: "Hi! Send us your reg and book in through our website." } });
check("reply publicly marks the lead replied", r.status === 200 && r.data?.lead?.status === "replied" && !!r.data.lead.reply_external_id && !!r.data.lead.replied_at, r.data);
r = await call(`/api/leads/${l1.id}/reply`, { method: "POST", body: { text: "again" } });
check("a lead can't be replied to twice", r.status === 409);

r = await call(`/api/leads/${l2.id}`, { method: "PATCH", body: { status: "dismissed" } });
check("a lead can be dismissed", r.status === 200 && r.data?.lead?.status === "dismissed");
r = await call("/api/leads?status=dismissed");
check("dismissed filter lists it", r.data?.leads?.length === 1 && r.data.leads[0].id === l2.id);

r = await call(`/api/leads/${l3.id}/book`, { method: "POST", body: {} });
check("book-in validates the name", r.status === 400 && !!r.data?.error?.fields?.name);
r = await call(`/api/leads/${l3.id}/book`, { method: "POST", body: { name: "Dan", phone: "07700 900456", reg: "AB12 CDE", service: "keys", description: "Mobile key programming, VW Golf 2020" } });
const booked = r.status === 201 && r.data?.lead?.status === "booked" && !!r.data?.booking?.id;
const clearError = r.status === 503 && r.data?.error?.code === "bookings_unavailable" && /booking/i.test(r.data?.error?.message || "");
check("book-in creates a booking, or explains bookings aren't available yet", booked || clearError, { status: r.status, data: r.data });
if (clearError) {
  r = await call(`/api/leads/${l3.id}`);
  check("a failed book-in leaves the lead open", r.data?.lead?.status === "new");
}

r = await call("/api/system/audit?limit=100");
const actions = (r.data?.entries || []).map(e => e.action);
check("lead changes are audited", ["lead.create", "lead.update", "lead.reply", "lead.dismiss"].every(a => actions.includes(a)), actions);

// ---- posting ----
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
let fd = new FormData();
fd.append("caption", "Stage 1 on an A45 today 🔥");
fd.append("account_ids", accountId);
fd.append("media", new Blob([png], { type: "image/png" }), "a45.png");
r = await call("/api/social/posts", { method: "POST", body: fd });
check("a post with a photo can be created", r.status === 201 && r.data?.post?.status === "draft" && r.data.post.targets?.length === 1, r.data);
const postId = r.data?.post?.id;

fd = new FormData();
fd.append("caption", "x");
fd.append("account_ids", accountId);
fd.append("media", new Blob([Buffer.from("MZ not an image at all")], { type: "image/png" }), "fake.png");
r = await call("/api/social/posts", { method: "POST", body: fd });
check("files that aren't really MP4/JPEG/PNG are refused", r.status === 400 && !!r.data?.error?.fields?.media, r.data);
fd = new FormData();
fd.append("caption", "x".repeat(2201));
fd.append("account_ids", accountId);
fd.append("media", new Blob([png], { type: "image/png" }), "a.png");
r = await call("/api/social/posts", { method: "POST", body: fd });
check("captions over 2200 characters are refused", r.status === 400 && !!r.data?.error?.fields?.caption);

r = await call(`/api/social/posts/${postId}/publish`, { method: "POST", body: {} });
check("publishing to the demo account succeeds", r.status === 200 && r.data?.post?.status === "published" && r.data.post.targets[0].status === "published" && !!r.data.post.targets[0].external_post_id, r.data);
r = await call("/api/social/posts");
check("post history shows per-account status", r.status === 200 && r.data?.posts?.[0]?.targets?.[0]?.platform === "instagram");

// A genuine link (signed here with the local ENCRYPTION_KEY, as the Hub does) streams the file, with ranges.
const devKey = (() => { try { return /^ENCRYPTION_KEY=(.+)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1]?.trim(); } catch { return null; } })();
if (devKey && postId) {
  const b64u = b => Buffer.from(b).toString("base64url");
  const hmacKey = Buffer.from(hkdfSync("sha256", Buffer.from(devKey, "base64"), "mk-hub", "social-media-token-v1", 32));
  const sign = (id, exp) => { const p = b64u(`${id}.${exp}`); return `${p}.${createHmac("sha256", hmacKey).update(p).digest("base64url")}`; };
  const valid = sign(postId, Math.floor(Date.now() / 1000) + 3600);
  r = await anon(`/api/public/media/${valid}`);
  const bytes = Buffer.from(await r.res.arrayBuffer());
  check("media link with a valid token streams the file", r.status === 200 && r.res.headers.get("content-type") === "image/png" && bytes.equals(png), r.status);
  r = await anon(`/api/public/media/${valid}`, { headers: { range: "bytes=0-7" } });
  check("media link supports range requests", r.status === 206 && (r.res.headers.get("content-range") || "").startsWith("bytes 0-7/"), r.status);
  r = await anon(`/api/public/media/${sign(postId, Math.floor(Date.now() / 1000) - 5)}`);
  check("expired media link is refused", r.status === 404);
}
r = await anon("/api/public/media/not-a-valid-token");
check("media link with a bad token is refused", r.status === 404);
r = await anon("/api/public/media/eyJwb3N0Ijoi.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
check("media link with a forged signature is refused", r.status === 404);

// ---- connecting accounts ----
r = await call("/api/social/connect/meta/start");
const loc = r.res.headers.get("location") || "";
const redirected = r.status === 302 && /^https:\/\/www\.facebook\.com\//.test(loc) && /[?&]state=[0-9a-f]{64}/.test(loc);
const explained = r.status === 400 && r.data?.error?.code === "not_configured" && /META_APP_ID/.test(r.data?.error?.message || "");
check("Meta connect redirects to Facebook with a state, or explains META_APP_ID is missing", redirected || explained, { status: r.status, loc, data: r.data });
r = await anon("/api/social/connect/meta/start");
check("connect start needs a signed-in user", r.status === 401);
r = await anon(`/api/social/connect/meta/callback?code=abc&state=${"0".repeat(64)}`);
const body = await r.res.text();
check("OAuth callback only bounces to the signed-in finish step", r.status === 200 && body.includes("/api/social/connect/meta/finish?code=abc&amp;state=") && !body.includes("<script"));
r = await call(`/api/social/connect/meta/finish?code=abc&state=${"0".repeat(64)}`);
check("finish with an unknown state is rejected", r.status === 302 && (r.res.headers.get("location") || "").endsWith("#/social/error/meta-state"), r.res.headers.get("location"));

r = await call(`/api/social/accounts/${accountId}`, { method: "DELETE" });
check("an account can be disconnected", r.status === 200);
r = await call("/api/social/accounts");
check("disconnected accounts drop off the list", !r.data?.accounts?.some(a => a.id === accountId));
r = await call(`/api/leads/${l3.id}/reply`, { method: "POST", body: { text: "Hi" } });
check("replying through a disconnected account is refused", r.status === 409, r.data);

done();
