// Invoices and quotes: what other modules may call (the mail module attaches PDFs and marks documents sent).
import type { Env } from "../../lib/env";
import { all, first, now, run } from "../../lib/db";
import { business } from "./business";
import { isOverdue, totals } from "./money";
import { renderDocumentPdf, type PdfLine } from "./pdf";

export const DOC_KINDS = ["invoice", "quote"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "void"] as const;

export interface DocumentRow {
  id: string; kind: DocKind; number: string; status: string;
  job_id: string | null; customer_id: string | null;
  bill_name: string; bill_email: string | null; bill_phone: string | null; bill_address: string | null;
  vehicle_reg: string | null; vehicle_desc: string | null; po_number: string | null;
  issue_date: string; due_date: string | null; notes: string | null;
  total_pence: number; paid_pence: number; quote_id: string | null;
  sent_at: string | null; paid_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export interface LineRow extends PdfLine { id: string; document_id: string; position: number; cost_pence: number | null; markup_pct: number | null }

export async function getDocument(env: Env, id: string): Promise<(DocumentRow & { lines: LineRow[] }) | null> {
  const doc = await first<DocumentRow>(env, "SELECT * FROM documents WHERE id = ?", id);
  if (!doc) return null;
  const lines = await all<LineRow>(env, "SELECT * FROM document_lines WHERE document_id = ? ORDER BY position", id);
  return { ...doc, lines };
}

/** Adds the figures the dashboard shows: totals by kind, balance and whether it's overdue. */
export function present(doc: DocumentRow & { lines?: LineRow[] }) {
  const t = doc.lines ? totals(doc.lines, doc.paid_pence) : { total: doc.total_pence, paid: doc.paid_pence, balance: doc.total_pence - doc.paid_pence };
  return { ...doc, ...("parts" in t ? { parts_pence: t.parts, labour_pence: t.labour, other_pence: t.other } : {}), balance_pence: t.balance, overdue: isOverdue(doc) };
}

export async function documentPdf(env: Env, id: string): Promise<{ doc: DocumentRow & { lines: LineRow[] }; bytes: Uint8Array; filename: string } | null> {
  const doc = await getDocument(env, id);
  if (!doc) return null;
  const bytes = await renderDocumentPdf(doc, business(env));
  const who = doc.vehicle_reg || doc.bill_name;
  const filename = `${doc.kind === "invoice" ? "Invoice" : "Quote"} ${doc.number}${who ? ` - ${who}` : ""}.pdf`.replace(/[\\/:*?"<>|]/g, "");
  return { doc, bytes, filename };
}

/** Called after a document goes out by email: drafts become sent. */
export async function markSent(env: Env, id: string): Promise<void> {
  const t = now();
  await run(env, "UPDATE documents SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = ?, updated_at = ? WHERE id = ?", t, t, id);
}
