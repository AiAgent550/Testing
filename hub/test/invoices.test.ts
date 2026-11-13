import { describe, expect, it } from "vitest";
import { addDays, gbp, isOverdue, lineTotal, priceFromMarkup, qtyLabel, totals } from "../src/modules/invoices/money";
import { pdfSafe, renderDocumentPdf, type PdfDoc } from "../src/modules/invoices/pdf";
import type { Business } from "../src/modules/invoices/business";

describe("invoice money", () => {
  it("adds lines in pence with no VAT", () => {
    const lines = [
      { kind: "part" as const, qty: 1, unit_pence: 27216 },
      { kind: "part" as const, qty: 5, unit_pence: 900 },
      { kind: "labour" as const, qty: 1, unit_pence: 51000 },
    ];
    expect(totals(lines, 10000)).toEqual({ parts: 31716, labour: 51000, other: 0, total: 82716, paid: 10000, balance: 72716 });
    expect(lineTotal({ qty: 1.5, unit_pence: 333 })).toBe(500);
  });
  it("works out a markup price and formats pounds", () => {
    expect(priceFromMarkup(24300, 12)).toBe(27216);
    expect(gbp(104537)).toBe("£1,045.37");
    expect(gbp(-10000)).toBe("-£100.00");
    expect(gbp(5)).toBe("£0.05");
    expect(qtyLabel(5, "L")).toBe("5 L");
    expect(qtyLabel(1.25)).toBe("1.25");
  });
  it("marks sent, unpaid invoices overdue after the due date", () => {
    const base = { kind: "invoice", status: "sent", issue_date: "2026-11-01", due_date: "2026-11-08", total_pence: 1000, paid_pence: 0 };
    expect(isOverdue(base, "2026-11-08")).toBe(false);
    expect(isOverdue(base, "2026-11-09")).toBe(true);
    expect(isOverdue({ ...base, paid_pence: 1000 }, "2026-12-01")).toBe(false);
    expect(isOverdue({ ...base, status: "draft" }, "2026-12-01")).toBe(false);
    expect(isOverdue({ ...base, due_date: null }, "2026-11-15")).toBe(false);
    expect(isOverdue({ ...base, due_date: null }, "2026-11-16")).toBe(true);
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("invoice PDF", () => {
  const b: Business = {
    tradingName: "Curve Performance", company: "M&K Auto Services Limited", companyNo: "NI719548",
    addressLines: ["28 Millbrook Drive", "Coalisland, BT71 4XH"], phone: "07734 272203", email: "info@curveperformance.co.uk",
    website: "curveperformance.co.uk", vatRegistered: false, bank: { name: "M&K Auto Services Limited", sortCode: "00-00-00", account: "00000000" },
  };
  const doc: PdfDoc = {
    kind: "invoice", number: "INV-1050", status: "draft",
    bill_name: "Paweł Łukasz Żółć", bill_email: "test@example.com", bill_phone: "07700 900123", bill_address: "1 Main Street\nDungannon BT70 1AA",
    vehicle_reg: "GRZ6348", vehicle_desc: "Renault Scenic", po_number: "PO31543",
    issue_date: "2026-11-13", due_date: "2026-11-20", notes: "Thanks for your business. Old parts returned to the customer.",
    paid_pence: 10000,
    lines: [
      ...Array.from({ length: 14 }, (_, i) => ({ kind: "part" as const, description: i === 2 ? "Timing belt kit and water pump with a very long description that has to wrap onto a second line in the table" : `Part number ${i + 1}`, qty: i === 3 ? 5 : 1, unit: i === 3 ? "L" : null, unit_pence: 2688 + i * 100 })),
      { kind: "labour" as const, description: "Labour", qty: 1, unit: null, unit_pence: 51000 },
    ],
  };
  it("strips characters the standard fonts can't draw", () => {
    expect(pdfSafe("Paweł Żółć → ok ✓")).toBe("Pawel Zolc  ok ");
  });
  it("renders an invoice and a quote", async () => {
    const bytes = await renderDocumentPdf(doc, b);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const quote = await renderDocumentPdf({ ...doc, kind: "quote", number: "QUO-1001", lines: doc.lines.slice(10), paid_pence: 0 }, b);
    expect(quote.length).toBeGreaterThan(1000);
    // Set PDF_OUT=<folder> to write the PDFs out and look at them.
    const out = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PDF_OUT;
    if (out) {
      const fs = await import(/* @vite-ignore */ "node:" + "fs") as { writeFileSync(p: string, d: Uint8Array): void };
      fs.writeFileSync(`${out}/inv.pdf`, bytes); fs.writeFileSync(`${out}/quo.pdf`, quote);
    }
  });
});
