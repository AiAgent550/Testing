// Module: invoices. Invoices and quotes with their own numbering (INV-1050..., QUO-1001...), line items for parts and
// labour (with optional cost and markup), payments, and PDFs. Emailing them is the mail module's job.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, first, newId, nextRef, now, run } from "../../lib/db";
import { badRequest, conflict, json, notFound } from "../../lib/http";
import { email, isoDate, nullable, oneOf, optional, parse, str } from "../../lib/validate";
import { addDays, totals, ukToday } from "./money";
import { DOC_KINDS, INVOICE_STATUSES, QUOTE_STATUSES, documentPdf, getDocument, present, type DocumentRow } from "./service";
import { formatReg } from "../jobs/service";

const LINE_KINDS = ["part", "labour", "other"] as const;
const MAX_LINES = 80;

/** Line items as sent by the dashboard. Money arrives in pence (whole numbers). */
function parseLines(raw: unknown) {
  if (!Array.isArray(raw)) throw badRequest("Some fields need fixing.", { lines: "Add at least one line." });
  if (raw.length > MAX_LINES) throw badRequest("Some fields need fixing.", { lines: `At most ${MAX_LINES} lines.` });
  return raw.map((l, i) => {
    const r = (l ?? {}) as Record<string, unknown>;
    const num = (v: unknown, f: string, { min = 0, max = 10_000_000, whole = false } = {}) => {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) {
        throw badRequest("Some fields need fixing.", { [`lines.${i}.${f}`]: "Check this number." });
      }
      return n;
    };
    const description = typeof r.description === "string" ? r.description.trim().slice(0, 300) : "";
    if (!description) throw badRequest("Some fields need fixing.", { [`lines.${i}.description`]: "Required." });
    const kind = LINE_KINDS.includes(r.kind as never) ? (r.kind as (typeof LINE_KINDS)[number]) : "part";
    const qty = r.qty === undefined || r.qty === null || r.qty === "" ? 1 : num(r.qty, "qty", { min: 0.01, max: 100000 });
    const unit = typeof r.unit === "string" && r.unit.trim() ? r.unit.trim().slice(0, 12) : null;
    const unit_pence = num(r.unit_pence, "unit_pence", { min: -10_000_000, whole: true });
    const cost_pence = r.cost_pence === undefined || r.cost_pence === null || r.cost_pence === "" ? null : num(r.cost_pence, "cost_pence", { whole: true });
    const markup_pct = r.markup_pct === undefined || r.markup_pct === null || r.markup_pct === "" ? null : num(r.markup_pct, "markup_pct", { min: -100, max: 1000 });
    return { kind, description, qty: Math.round(qty * 100) / 100, unit, unit_pence, cost_pence, markup_pct };
  });
}

const DOC_SHAPE = {
  job_id: nullable(str({ max: 64 })),
  customer_id: nullable(str({ max: 64 })),
  bill_name: optional(str({ max: 200 })),
  bill_email: nullable(email()),
  bill_phone: nullable(str({ max: 40 })),
  bill_address: nullable(str({ max: 500 })),
  vehicle_reg: nullable(str({ max: 12 })),
  vehicle_desc: nullable(str({ max: 120 })),
  po_number: nullable(str({ max: 60 })),
  issue_date: optional(isoDate()),
  due_date: nullable(isoDate()),
  notes: nullable(str({ max: 2000 })),
  paid_pence: optional((v: unknown, f: string) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100_000_000) throw badRequest("Some fields need fixing.", { [f]: "Check this amount." });
    return n;
  }),
};

async function checkLinks(ctx: Ctx, input: { job_id?: string | null; customer_id?: string | null }) {
  if (input.job_id && !(await first(ctx.env, "SELECT 1 AS ok FROM jobs WHERE id = ?", input.job_id))) throw badRequest("Some fields need fixing.", { job_id: "That job wasn't found." });
  if (input.customer_id && !(await first(ctx.env, "SELECT 1 AS ok FROM customers WHERE id = ?", input.customer_id))) throw badRequest("Some fields need fixing.", { customer_id: "That customer wasn't found." });
}

async function writeLines(ctx: Ctx, docId: string, lines: ReturnType<typeof parseLines>) {
  const stmts = [ctx.env.DB.prepare("DELETE FROM document_lines WHERE document_id = ?").bind(docId)];
  lines.forEach((l, i) => stmts.push(ctx.env.DB.prepare(
    "INSERT INTO document_lines (id, document_id, position, kind, description, qty, unit, unit_pence, cost_pence, markup_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(newId("dln"), docId, i, l.kind, l.description, l.qty, l.unit, l.unit_pence, l.cost_pence, l.markup_pct)));
  await ctx.env.DB.batch(stmts);
}

async function mustGet(ctx: Ctx) {
  const doc = await getDocument(ctx.env, ctx.params.id);
  if (!doc) throw notFound("Document");
  return doc;
}

// ---------- list ----------
async function list(ctx: Ctx) {
  const q = ctx.url.searchParams;
  const kind = q.get("kind") || "invoice";
  if (!DOC_KINDS.includes(kind as never)) throw badRequest("Unknown kind.");
  const filter = q.get("filter") || "all";
  const where = ["kind = ?"];
  const params: unknown[] = [kind];
  if (q.get("job_id")) { where.push("job_id = ?"); params.push(q.get("job_id")); }
  if (filter === "unpaid") where.push("status = 'sent' AND paid_pence < total_pence");
  else if (filter === "draft") where.push("status = 'draft'");
  else if (filter === "paid") where.push("status = 'paid'");
  else if (filter === "open") where.push("status IN ('draft','sent')");
  const rows = await all<DocumentRow>(ctx.env, `SELECT * FROM documents WHERE ${where.join(" AND ")} ORDER BY issue_date DESC, number DESC LIMIT 300`, ...params);
  let docs = rows.map(r => present(r));
  if (filter === "overdue") docs = docs.filter(d => d.overdue);
  const unpaid = await first<{ n: number; due: number }>(ctx.env,
    "SELECT COUNT(*) AS n, COALESCE(SUM(total_pence - paid_pence), 0) AS due FROM documents WHERE kind = 'invoice' AND status = 'sent' AND paid_pence < total_pence");
  return json({ documents: docs, unpaid: { count: unpaid?.n ?? 0, pence: unpaid?.due ?? 0 } });
}

// ---------- create / read / update ----------
async function create(ctx: Ctx) {
  const user = userOf(ctx);
  const raw = (await ctx.body()) as Record<string, unknown>;
  const { kind } = parse(raw, { kind: oneOf(DOC_KINDS) });
  const input = parse(raw, DOC_SHAPE);
  const lines = parseLines(raw.lines ?? []);
  if (!input.bill_name) throw badRequest("Some fields need fixing.", { bill_name: "Required." });
  await checkLinks(ctx, input);
  const issue = input.issue_date ?? ukToday();
  const due = input.due_date === undefined ? (kind === "quote" ? addDays(issue, 30) : null) : input.due_date;
  const t = totals(lines, input.paid_pence ?? 0);
  const id = newId("doc");
  const number = await nextRef(ctx.env, kind === "invoice" ? "invoice_ref" : "quote_ref", kind === "invoice" ? "INV" : "QUO");
  const ts = now();
  await run(ctx.env,
    `INSERT INTO documents (id, kind, number, status, job_id, customer_id, bill_name, bill_email, bill_phone, bill_address, vehicle_reg, vehicle_desc,
       po_number, issue_date, due_date, notes, total_pence, paid_pence, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, kind, number, input.job_id ?? null, input.customer_id ?? null, input.bill_name, input.bill_email ?? null, input.bill_phone ?? null,
    input.bill_address ?? null, input.vehicle_reg ? formatReg(input.vehicle_reg.toUpperCase().replace(/\s/g, "")) : null, input.vehicle_desc ?? null,
    input.po_number ?? null, issue, due, input.notes ?? null, t.total, input.paid_pence ?? 0, user.id, ts, ts);
  if (lines.length) await writeLines(ctx, id, lines);
  await audit(ctx.env, user.id, `${kind}.create`, "document", id, { number, total_pence: t.total });
  return json({ document: present((await getDocument(ctx.env, id))!) }, 201);
}

async function read(ctx: Ctx) {
  const doc = await mustGet(ctx);
  const emails = await all(ctx.env, "SELECT id, purpose, to_email, subject, status, error, created_at FROM outbound_emails WHERE document_id = ? ORDER BY created_at DESC LIMIT 20", doc.id);
  return json({ document: present(doc), emails });
}

async function update(ctx: Ctx) {
  const user = userOf(ctx);
  const doc = await mustGet(ctx);
  if (doc.status === "void") throw conflict("This document is void. Make a new one instead.");
  const raw = (await ctx.body()) as Record<string, unknown>;
  const input = parse(raw, DOC_SHAPE);
  await checkLinks(ctx, input);
  const lines = raw.lines !== undefined ? parseLines(raw.lines) : null;
  const paid = input.paid_pence ?? doc.paid_pence;
  const t = totals(lines ?? doc.lines, paid);
  const cols: Record<string, unknown> = {
    job_id: input.job_id, customer_id: input.customer_id, bill_name: input.bill_name, bill_email: input.bill_email, bill_phone: input.bill_phone,
    bill_address: input.bill_address, vehicle_reg: input.vehicle_reg === undefined ? undefined : input.vehicle_reg ? formatReg(input.vehicle_reg.toUpperCase().replace(/\s/g, "")) : null,
    vehicle_desc: input.vehicle_desc, po_number: input.po_number, issue_date: input.issue_date, due_date: input.due_date, notes: input.notes,
    paid_pence: input.paid_pence, total_pence: t.total,
  };
  // Paying the whole balance closes a sent invoice; changing lines or payments re-opens a paid one if money is still owed.
  if (doc.kind === "invoice" && doc.status !== "draft") {
    if (t.total > 0 && paid >= t.total && doc.status !== "paid") { cols.status = "paid"; cols.paid_at = now(); }
    else if (paid < t.total && doc.status === "paid") { cols.status = "sent"; cols.paid_at = null; }
  }
  const keys = Object.keys(cols).filter(k => cols[k] !== undefined);
  const ts = now();
  await run(ctx.env, `UPDATE documents SET ${keys.map(k => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...keys.map(k => cols[k]), ts, doc.id);
  if (lines) await writeLines(ctx, doc.id, lines);
  await audit(ctx.env, user.id, `${doc.kind}.update`, "document", doc.id, { fields: keys, total_pence: t.total });
  return json({ document: present((await getDocument(ctx.env, doc.id))!) });
}

// ---------- status, payments, conversion ----------
async function setStatus(ctx: Ctx) {
  const user = userOf(ctx);
  const doc = await mustGet(ctx);
  const allowed = doc.kind === "invoice" ? INVOICE_STATUSES : QUOTE_STATUSES;
  const { status } = parse(await ctx.body(), { status: oneOf(allowed as readonly string[]) });
  if (doc.status === "void" && status !== "void") throw conflict("This document is void. Make a new one instead.");
  const ts = now();
  if (doc.kind === "invoice" && status === "paid") {
    // Marking paid records the full amount as received.
    await run(ctx.env, "UPDATE documents SET status = 'paid', paid_pence = total_pence, paid_at = ?, updated_at = ? WHERE id = ?", ts, ts, doc.id);
  } else {
    await run(ctx.env, "UPDATE documents SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN paid_at ELSE NULL END, updated_at = ? WHERE id = ?", status, status, ts, doc.id);
  }
  await audit(ctx.env, user.id, `${doc.kind}.status`, "document", doc.id, { from: doc.status, to: status });
  return json({ document: present((await getDocument(ctx.env, doc.id))!) });
}

async function convertQuote(ctx: Ctx) {
  const user = userOf(ctx);
  const quote = await mustGet(ctx);
  if (quote.kind !== "quote") throw badRequest("Only a quote can be turned into an invoice.");
  const existing = await first<{ id: string }>(ctx.env, "SELECT id FROM documents WHERE quote_id = ? AND status != 'void'", quote.id);
  if (existing) return json({ document: present((await getDocument(ctx.env, existing.id))!), created: false });
  const id = newId("doc");
  const number = await nextRef(ctx.env, "invoice_ref", "INV");
  const ts = now();
  await run(ctx.env,
    `INSERT INTO documents (id, kind, number, status, job_id, customer_id, bill_name, bill_email, bill_phone, bill_address, vehicle_reg, vehicle_desc,
       po_number, issue_date, due_date, notes, total_pence, paid_pence, quote_id, created_by, created_at, updated_at)
     VALUES (?, 'invoice', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`,
    id, number, quote.job_id, quote.customer_id, quote.bill_name, quote.bill_email, quote.bill_phone, quote.bill_address,
    quote.vehicle_reg, quote.vehicle_desc, quote.po_number, ukToday(), quote.total_pence, quote.id, user.id, ts, ts);
  await writeLines(ctx, id, quote.lines.map(l => ({ kind: l.kind, description: l.description, qty: l.qty, unit: l.unit, unit_pence: l.unit_pence, cost_pence: l.cost_pence, markup_pct: l.markup_pct })));
  if (quote.status === "draft" || quote.status === "sent") await run(ctx.env, "UPDATE documents SET status = 'accepted', updated_at = ? WHERE id = ?", ts, quote.id);
  await audit(ctx.env, user.id, "quote.convert", "document", quote.id, { invoice_id: id, number });
  return json({ document: present((await getDocument(ctx.env, id))!), created: true }, 201);
}

async function remove(ctx: Ctx) {
  const doc = await mustGet(ctx);
  // Numbers must stay in sequence for the accounts: only the newest, never-sent draft can be deleted (its number is
  // handed out again); anything else is marked void instead.
  if (doc.status !== "draft" || doc.sent_at) throw conflict("Only unsent drafts can be deleted. Mark it void instead.");
  const counter = doc.kind === "invoice" ? "invoice_ref" : "quote_ref";
  const n = Number(doc.number.split("-")[1]);
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE counters SET value = value - 1 WHERE name = ? AND value = ?").bind(counter, n),
    ctx.env.DB.prepare("DELETE FROM documents WHERE id = ? AND EXISTS (SELECT 1 FROM counters WHERE name = ? AND value = ?)").bind(doc.id, counter, n - 1),
  ]);
  if (!res[1].meta.changes) throw conflict("Only the newest draft can be deleted, so numbers stay in order. Mark this one void instead.");
  await audit(ctx.env, userOf(ctx).id, `${doc.kind}.delete`, "document", doc.id, { number: doc.number });
  return json({ ok: true });
}

async function pdf(ctx: Ctx) {
  const out = await documentPdf(ctx.env, ctx.params.id);
  if (!out) throw notFound("Document");
  const download = ctx.url.searchParams.get("download") === "1";
  const ascii = out.filename.replace(/[^\x20-\x7e]/g, "_");
  return new Response(out.bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, no-store",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    },
  });
}

/** Everything needed to start an invoice or quote from a job: who to bill and which car. */
async function prefillFromJob(ctx: Ctx) {
  const job = await first<{ id: string; ref: string; title: string; customer_id: string | null; vehicle_id: string | null }>(ctx.env, "SELECT id, ref, title, customer_id, vehicle_id FROM jobs WHERE id = ?", ctx.params.jobId);
  if (!job) throw notFound("Job");
  const [c, v] = await Promise.all([
    job.customer_id ? first<{ id: string; name: string; email: string | null; phone: string | null }>(ctx.env, "SELECT id, name, email, phone FROM customers WHERE id = ?", job.customer_id) : null,
    job.vehicle_id ? first<{ reg: string; make: string | null; model: string | null; year: number | null }>(ctx.env, "SELECT reg, make, model, year FROM vehicles WHERE id = ?", job.vehicle_id) : null,
  ]);
  return json({
    job_id: job.id, customer_id: c?.id ?? null, bill_name: c?.name ?? "", bill_email: c?.email ?? null,
    bill_phone: c?.phone ? (c.phone.startsWith("+44") ? "0" + c.phone.slice(3) : c.phone) : null,
    vehicle_reg: v?.reg ? formatReg(v.reg) : null,
    vehicle_desc: v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || null : null,
  });
}

const invoices: Module = {
  name: "invoices",
  register(r) {
    r.get("/api/documents", list);
    r.post("/api/documents", create);
    r.get("/api/documents/prefill/:jobId", prefillFromJob);
    r.get("/api/documents/:id", read);
    r.patch("/api/documents/:id", update);
    r.delete("/api/documents/:id", remove);
    r.post("/api/documents/:id/status", setStatus);
    r.post("/api/documents/:id/convert", convertQuote);
    r.get("/api/documents/:id/pdf", pdf);
  },
};
export default invoices;
