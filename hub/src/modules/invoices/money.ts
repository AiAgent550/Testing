// Money for invoices and quotes. Everything is whole pence; the business isn't VAT registered, so there is no VAT.

export interface LineInput { qty: number; unit_pence: number; kind: "part" | "labour" | "other" }

/** One line's amount: quantity x unit price, rounded to the penny. */
export const lineTotal = (l: Pick<LineInput, "qty" | "unit_pence">): number => Math.round(l.qty * l.unit_pence);

export function totals(lines: LineInput[], paidPence = 0) {
  const by = { part: 0, labour: 0, other: 0 };
  for (const l of lines) by[l.kind] += lineTotal(l);
  const total = by.part + by.labour + by.other;
  return { parts: by.part, labour: by.labour, other: by.other, total, paid: paidPence, balance: total - paidPence };
}

/** Selling price from cost and a markup percentage, rounded to the penny. */
export const priceFromMarkup = (costPence: number, markupPct: number): number => Math.round(costPence * (1 + markupPct / 100));

/** £1,045.37 (negative amounts as -£100.00). */
export function gbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

/** "5 L", "1", "1.5 h" - quantity as printed. */
export function qtyLabel(qty: number, unit?: string | null): string {
  const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  return unit ? `${n} ${unit}` : n;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "4 Nov 2026" */
export function longDate(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Today in the UK as YYYY-MM-DD. */
export function ukToday(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** An unpaid invoice is overdue the day after its due date (or after 14 days when due on receipt). */
export function isOverdue(doc: { kind: string; status: string; issue_date: string; due_date: string | null; total_pence: number; paid_pence: number }, today = ukToday()): boolean {
  if (doc.kind !== "invoice" || doc.status !== "sent" || doc.paid_pence >= doc.total_pence) return false;
  return today > (doc.due_date ?? addDays(doc.issue_date, 14));
}
