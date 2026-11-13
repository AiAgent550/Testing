// Module: mail. Emails to customers from info@ (Cloudflare Email Service): job reports with photos, invoices, quotes
// and payment reminders. Every email is logged. Videos, and photos that don't fit in one email, go as a private link
// to a page on the Hub that works for 30 days without signing in.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import type { Env } from "../../lib/env";
import { audit } from "../../lib/audit";
import { all, first, newId, now, run } from "../../lib/db";
import { HttpError, badRequest, json, notFound } from "../../lib/http";
import { email, oneOf, optional, parse, str } from "../../lib/validate";
import { randomToken, sha256Hex } from "../../lib/crypto";
import { business, legalLine } from "../invoices/business";
import { documentPdf, markSent } from "../invoices/service";
import { longDate, ukToday, addDays } from "../invoices/money";
import { serveStored } from "../../lib/storage";
import { composeEmail, planAttachments } from "./compose";

const PURPOSES = ["report", "invoice", "quote", "reminder", "other"] as const;
/** Cloudflare allows 25 MiB per message after encoding; attachments grow by a third when encoded. */
const ATTACH_BUDGET = 17 * 1024 * 1024;
const LINK_DAYS = 30;

interface FileRow { id: string; job_id: string; kind: "photo" | "video"; r2_key: string; preview_key: string | null; content_type: string; size: number; preview_size: number | null; filename: string | null }

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

/** Friendly reasons for Email Service errors. */
function mailError(err: unknown): HttpError {
  const code = (err as { code?: string })?.code || "";
  const msg = (err as Error)?.message || String(err);
  if (code === "E_SENDER_DOMAIN_NOT_AVAILABLE" || code === "E_SENDER_NOT_VERIFIED") return new HttpError(503, "mail_not_ready", "Email sending isn't switched on for curveperformance.co.uk yet.");
  if (code === "E_RECIPIENT_NOT_ALLOWED") return new HttpError(503, "mail_not_ready", "Email sending to customers isn't switched on yet (it needs the Workers Paid plan).");
  if (code === "E_RECIPIENT_SUPPRESSED") return new HttpError(400, "mail_suppressed", "That address has bounced or blocked our emails before. Check it with the customer.");
  if (code === "E_CONTENT_TOO_LARGE") return new HttpError(413, "too_large", "The email is too big. Untick some photos.");
  if (code === "E_RATE_LIMIT_EXCEEDED" || code === "E_DAILY_LIMIT_EXCEEDED") return new HttpError(429, "rate_limited", "Too many emails sent for now. Try again later.");
  if (code === "E_VALIDATION_ERROR" || code === "E_FIELD_MISSING") return new HttpError(400, "bad_request", "The email couldn't be sent. Check the address and try again.");
  console.error("mail send failed", code, msg);
  return new HttpError(502, "mail_failed", "The email couldn't be sent. Try again in a minute.");
}

async function send(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const raw = (await ctx.body()) as Record<string, unknown>;
  const input = parse(raw, {
    purpose: oneOf(PURPOSES),
    to: email(),
    subject: str({ max: 200 }),
    message: str({ max: 8000 }),
    job_id: optional(str({ max: 64 })),
  });
  const docIds = Array.isArray(raw.document_ids) ? raw.document_ids.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  const fileIds = Array.isArray(raw.file_ids) ? [...new Set(raw.file_ids.filter((x): x is string => typeof x === "string"))].slice(0, 60) : [];
  if (fileIds.length && !input.job_id) throw badRequest("Photos can only be sent from a job.");
  if (input.job_id && !(await first(env, "SELECT 1 AS ok FROM jobs WHERE id = ?", input.job_id))) throw notFound("Job");
  if (!env.EMAIL) throw new HttpError(503, "mail_not_ready", "Email sending isn't switched on yet.");

  const attachments: { content: Uint8Array; filename: string; type: string; disposition: "attachment" }[] = [];
  const sentDocs: string[] = [];
  for (const id of docIds) {
    const out = await documentPdf(env, id);
    if (!out) throw notFound("Document");
    if (input.job_id && out.doc.job_id && out.doc.job_id !== input.job_id) throw badRequest("That invoice belongs to another job.");
    if (out.doc.status === "void") throw badRequest(`${out.doc.number} is void, so it can't be sent.`);
    attachments.push({ content: out.bytes, filename: out.filename, type: "application/pdf", disposition: "attachment" });
    sentDocs.push(id);
  }

  // Photos and videos: attach what fits, link the rest.
  let link: { url: string; count: number; expires: string } | null = null;
  let linkId: string | null = null;
  if (fileIds.length) {
    const rows = await all<FileRow>(env, `SELECT id, job_id, kind, r2_key, preview_key, content_type, size, preview_size, filename FROM job_files WHERE job_id = ? AND id IN (${fileIds.map(() => "?").join(",")})`, input.job_id, ...fileIds);
    if (rows.length !== fileIds.length) throw badRequest("Some photos weren't found on this job. Refresh and try again.");
    const ordered = fileIds.map(id => rows.find(r => r.id === id)!);
    const pdfBytes = attachments.reduce((n, a) => n + a.content.length, 0);
    const plan = planAttachments(ordered.map(r => ({ id: r.id, kind: r.kind, bytes: r.preview_size ?? r.size })), ATTACH_BUDGET - pdfBytes);
    let n = 0;
    for (const id of plan.attach) {
      const r = ordered.find(x => x.id === id)!;
      const obj = await env.FILES.get(r.preview_key ?? r.r2_key);
      if (!obj) { plan.link.push(id); continue; }
      n++;
      const type = r.preview_key ? "image/jpeg" : r.content_type;
      attachments.push({ content: new Uint8Array(await obj.arrayBuffer()), filename: `Photo ${n}.${EXT[type] ?? "jpg"}`, type, disposition: "attachment" });
    }
    if (plan.link.length) {
      const token = randomToken(24);
      linkId = newId("shl");
      const expiresDay = addDays(ukToday(), LINK_DAYS);
      const job = await first<{ title: string; ref: string }>(env, "SELECT title, ref FROM jobs WHERE id = ?", input.job_id);
      await run(env, "INSERT INTO share_links (id, token_hash, job_id, file_ids, title, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        linkId, await sha256Hex(token), input.job_id, JSON.stringify(plan.link), job?.title ?? "Your job", `${expiresDay}T23:59:59.000Z`, user.id, now());
      link = { url: `${env.APP_ORIGIN}/r/${token}`, count: plan.link.length, expires: longDate(expiresDay) };
    }
  }

  const b = business(env);
  const { text, html } = composeEmail({ message: input.message, link, business: { ...b, legal: legalLine(b) } });
  const id = newId("eml");
  const log = async (status: "sent" | "failed", error: string | null, messageId: string | null) =>
    run(env, `INSERT INTO outbound_emails (id, job_id, document_id, purpose, to_email, subject, body, attachments, link_id, status, error, message_id, sent_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.job_id ?? null, sentDocs[0] ?? null, input.purpose, input.to, input.subject, text,
      JSON.stringify(attachments.map(a => ({ name: a.filename, size: a.content.length }))), linkId, status, error, messageId, user.id, now());

  let messageId: string;
  try {
    const res = await env.EMAIL.send({
      from: { email: b.email, name: b.tradingName },
      replyTo: { email: b.email, name: b.tradingName },
      to: input.to,
      ...(env.MAIL_BCC ? { bcc: env.MAIL_BCC } : {}),
      subject: input.subject,
      text, html,
      attachments,
    });
    messageId = res?.messageId ?? "";
  } catch (err) {
    const e = mailError(err);
    await log("failed", `${(err as { code?: string })?.code ?? ""} ${e.message}`.trim(), null);
    if (linkId) await run(env, "DELETE FROM share_links WHERE id = ?", linkId);
    throw e;
  }
  await log("sent", null, messageId);
  for (const d of sentDocs) await markSent(env, d);
  await audit(env, user.id, "mail.send", input.job_id ? "job" : "document", input.job_id ?? sentDocs[0] ?? id, { email_id: id, purpose: input.purpose, attachments: attachments.length, link: !!link });
  return json({ email: { id, to: input.to, subject: input.subject, status: "sent", attachments: attachments.map(a => a.filename), link: link?.url ?? null } }, 201);
}

async function list(ctx: Ctx) {
  const q = ctx.url.searchParams;
  const jobId = q.get("job_id"), docId = q.get("document_id");
  if (!jobId && !docId) throw badRequest("Say which job or document.");
  const rows = await all<{ attachments: string } & Record<string, unknown>>(ctx.env,
    `SELECT e.id, e.purpose, e.to_email, e.subject, e.attachments, e.status, e.error, e.created_at, e.document_id, u.name AS sent_by_name,
            (SELECT expires_at FROM share_links s WHERE s.id = e.link_id) AS link_expires
       FROM outbound_emails e LEFT JOIN users u ON u.id = e.sent_by
      WHERE ${jobId ? "e.job_id = ?" : "e.document_id = ?"} ORDER BY e.created_at DESC LIMIT 30`, jobId ?? docId);
  return json({ emails: rows.map(r => ({ ...r, attachments: JSON.parse(r.attachments || "[]") })) });
}

/** Whether customer email is set up, so the dashboard can say so before anyone types a message. */
function status(ctx: Ctx) {
  return json({ available: !!ctx.env.EMAIL, from: business(ctx.env).email });
}

// ---------- the customer's private photo/video page ----------
interface LinkRow { id: string; job_id: string; file_ids: string; title: string; expires_at: string }

async function findLink(env: Env, token: string): Promise<LinkRow | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const row = await first<LinkRow>(env, "SELECT id, job_id, file_ids, title, expires_at FROM share_links WHERE token_hash = ?", await sha256Hex(token));
  if (!row || row.expires_at < now()) return null;
  return row;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} · Curve Performance</title>
<link rel="stylesheet" href="/assets/share.css"></head><body><header><b>CURVE</b> PERFORMANCE</header><main>${body}</main>
<footer>Curve Performance · 07734 272203 · <a href="https://curveperformance.co.uk">curveperformance.co.uk</a></footer></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" } });

async function sharePage(ctx: Ctx) {
  const link = await findLink(ctx.env, ctx.params.token);
  if (!link) return page("Link expired", `<h1>This link has expired</h1><p>Photo links work for ${LINK_DAYS} days. Call us on 07734 272203 or reply to our email and we'll send a new one.</p>`, 404);
  const ids = JSON.parse(link.file_ids) as string[];
  const files = await all<FileRow>(ctx.env, `SELECT id, job_id, kind, r2_key, preview_key, content_type, size, preview_size, filename FROM job_files WHERE job_id = ? AND id IN (${ids.map(() => "?").join(",") || "''"})`, link.job_id, ...ids);
  const base = `/r/${ctx.params.token}/f`;
  const items = ids.map(id => files.find(f => f.id === id)).filter((f): f is FileRow => !!f).map((f, i) => f.kind === "video"
    ? `<figure><video controls playsinline preload="metadata" src="${base}/${f.id}"></video><figcaption>Video ${i + 1} · <a href="${base}/${f.id}?download=1">Download</a></figcaption></figure>`
    : `<figure><a href="${base}/${f.id}"><img loading="lazy" alt="Photo ${i + 1}" src="${base}/${f.id}${f.preview_key ? "?v=preview" : ""}"></a><figcaption>Photo ${i + 1} · <a href="${base}/${f.id}?download=1">Full size</a></figcaption></figure>`);
  const expires = longDate(link.expires_at.slice(0, 10));
  return page(link.title, `<h1>${esc(link.title)}</h1><p class="muted">Photos and videos from your job. This private link works until ${esc(expires)}.</p>
<section class="grid">${items.join("") || "<p>Nothing to show.</p>"}</section>`);
}

async function shareFile(ctx: Ctx) {
  const link = await findLink(ctx.env, ctx.params.token);
  if (!link || !(JSON.parse(link.file_ids) as string[]).includes(ctx.params.fileId)) return new Response("Not found", { status: 404 });
  const f = await first<FileRow>(ctx.env, "SELECT id, job_id, kind, r2_key, preview_key, content_type, size, preview_size, filename FROM job_files WHERE id = ? AND job_id = ?", ctx.params.fileId, link.job_id);
  if (!f) return new Response("Not found", { status: 404 });
  const preview = ctx.url.searchParams.get("v") === "preview" && f.preview_key;
  const res = await serveStored(ctx.env, ctx.req, preview ? f.preview_key! : f.r2_key, preview ? "image/jpeg" : f.content_type, "private, max-age=86400");
  if (ctx.url.searchParams.get("download") === "1") {
    const ext = f.kind === "video" ? (f.content_type === "video/quicktime" ? "mov" : f.content_type === "video/webm" ? "webm" : "mp4") : EXT[f.content_type] ?? "jpg";
    res.headers.set("content-disposition", `attachment; filename="curve-${f.kind}-${f.id.slice(-6)}.${ext}"`);
  }
  return res;
}

const mail: Module = {
  name: "mail",
  register(r) {
    r.get("/api/mail/status", status);
    r.get("/api/mail", list);
    r.post("/api/mail/send", send);
    r.get("/r/:token", sharePage, "public");
    r.get("/r/:token/f/:fileId", shareFile, "public");
  },
  async scheduled(env) {
    // Expired links stop working at once; tidy their rows a week later.
    await run(env, "DELETE FROM share_links WHERE expires_at < ?", new Date(Date.now() - 7 * 86400_000).toISOString());
  },
};
export default mail;
