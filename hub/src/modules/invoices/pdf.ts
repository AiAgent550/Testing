// Invoice and quote PDFs, drawn directly (no browser): A4, Curve Performance look, standard PDF fonts.
// Same layout as the invoices made by hand before the Hub: logo top left, title top right, From / Bill to /
// Details, parts and labour tables, how to pay, totals, and the legal line at the foot of every page.
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LOGO_FILL, LOGO_STROKES, LOGO_W } from "./logo";
import { gbp, lineTotal, longDate, qtyLabel, totals } from "./money";
import { legalLine, type Business } from "./business";

export interface PdfLine { kind: "part" | "labour" | "other"; description: string; qty: number; unit: string | null; unit_pence: number }
export interface PdfDoc {
  kind: "invoice" | "quote";
  number: string;
  status: string;
  bill_name: string; bill_email: string | null; bill_phone: string | null; bill_address: string | null;
  vehicle_reg: string | null; vehicle_desc: string | null;
  po_number: string | null;
  issue_date: string; due_date: string | null;
  notes: string | null;
  paid_pence: number;
  lines: PdfLine[];
}

const W = 595.28, H = 841.89, M = 44;
const INK = rgb(0.043, 0.055, 0.071), SOFT = rgb(0.33, 0.37, 0.42), FAINT = rgb(0.55, 0.59, 0.64), LINE = rgb(0.86, 0.88, 0.9);
const COLS = { desc: M, qty: 382, price: 470, amount: W - M }; // qty/price/amount are right edges

interface Fonts { reg: PDFFont; bold: PDFFont; mono: PDFFont }

/** Text the standard fonts can't draw (Polish letters, emoji) is simplified rather than failing the PDF. */
export function pdfSafe(text: string): string {
  return String(text ?? "")
    .replace(/[łŁ]/g, c => (c === "ł" ? "l" : "L"))
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\t/g, " ")
    .replace(/[^\n\x20-\x7e -ÿ–—•€]/g, "");
}

function spaced(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = INK, tracking = 0, align: "left" | "right" = "left") {
  const s = pdfSafe(text);
  const width = font.widthOfTextAtSize(s, size) + tracking * Math.max(0, s.length - 1);
  let cx = align === "right" ? x - width : x;
  if (!tracking) { page.drawText(s, { x: cx, y, size, font, color }); return width; }
  for (const ch of s) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + tracking;
  }
  return width;
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= max) { line = tryLine; continue; }
      if (line) out.push(line);
      // A single word wider than the column is cut to fit.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > max && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > max) n--;
        out.push(w.slice(0, n)); w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

function drawLogo(page: PDFPage, x: number, top: number, width: number) {
  const s = width / LOGO_W;
  for (const st of LOGO_STROKES) {
    page.drawSvgPath(st.d, { x: x + st.x * s, y: top - st.y * s, scale: st.scale * s, borderColor: INK, borderWidth: st.width, borderLineCap: LineCapStyle.Round });
  }
  page.drawSvgPath(LOGO_FILL, { x, y: top, scale: s, color: INK, borderWidth: 0 });
}

function header(page: PDFPage, f: Fonts, doc: PdfDoc) {
  // Thin graphite band across the top, fading out to the right.
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const tint = 0.04 + (0.86 * i) / steps;
    page.drawRectangle({ x: (W * i) / steps, y: H - 6, width: W / steps + 0.5, height: 6, color: rgb(tint, tint + 0.01, tint + 0.02) });
  }
  drawLogo(page, M - 4, H - 30, 132);
  spaced(page, "REMAPPING  ·  KEYS  ·  CODING  ·  REPAIRS", M, H - 112, 6.5, f.reg, FAINT, 1.4);
  spaced(page, doc.kind === "invoice" ? "INVOICE" : "QUOTE", W - M, H - 66, 26, f.reg, INK, 6, "right");
  spaced(page, doc.number, W - M, H - 84, 9, f.mono, SOFT, 0.5, "right");
  page.drawLine({ start: { x: M, y: H - 128 }, end: { x: W - M, y: H - 128 }, thickness: 0.8, color: INK });
}

function footer(page: PDFPage, f: Fonts, b: Business, pageNo: number, pages: number) {
  page.drawLine({ start: { x: M, y: 62 }, end: { x: W - M, y: 62 }, thickness: 0.5, color: LINE });
  const lines = wrap(legalLine(b), f.reg, 7, 380);
  lines.forEach((l, i) => page.drawText(l, { x: M, y: 48 - i * 9.5, size: 7, font: f.reg, color: SOFT }));
  spaced(page, b.website, W - M, 48, 7.5, f.mono, SOFT, 0, "right");
  if (pages > 1) spaced(page, `Page ${pageNo} of ${pages}`, W - M, 38.5, 7, f.reg, FAINT, 0, "right");
}

function label(page: PDFPage, f: Fonts, text: string, x: number, y: number, align: "left" | "right" = "left") {
  spaced(page, text.toUpperCase(), x, y, 6.5, f.mono, FAINT, 1.2, align);
}

export async function renderDocumentPdf(doc: PdfDoc, b: Business): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const f: Fonts = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const isInvoice = doc.kind === "invoice";
  pdf.setTitle(`${isInvoice ? "Invoice" : "Quote"} ${doc.number} - ${b.tradingName}`);
  pdf.setAuthor(b.company);
  pdf.setCreator("Curve Hub");
  pdf.setProducer("Curve Hub");
  pdf.setCreationDate(new Date(`${doc.issue_date}T12:00:00Z`));

  let page = pdf.addPage([W, H]);
  header(page, f, doc);

  // ---- From / Bill to / Details ----
  let y = H - 152;
  const colX = [M, 214, 384];
  label(page, f, "From", colX[0], y);
  label(page, f, isInvoice ? "Bill to" : "Quote for", colX[1], y);
  label(page, f, "Details", colX[2], y);
  y -= 16;
  const from = [b.company, ...b.addressLines, b.phone, b.email];
  page.drawText(pdfSafe(b.tradingName), { x: colX[0], y, size: 9.5, font: f.bold, color: INK });
  from.forEach((l, i) => page.drawText(pdfSafe(l), { x: colX[0], y: y - 13 * (i + 1), size: 8.5, font: f.reg, color: SOFT }));

  const billLines = [
    ...(doc.bill_address ? doc.bill_address.split("\n") : []),
    doc.bill_phone, doc.bill_email,
    doc.vehicle_reg || doc.vehicle_desc ? `Vehicle: ${[doc.vehicle_reg, doc.vehicle_desc].filter(Boolean).join(" · ")}` : null,
  ].filter((l): l is string => !!l && !!l.trim());
  const nameLines = wrap(doc.bill_name, f.bold, 9.5, 158);
  nameLines.forEach((l, i) => page.drawText(l, { x: colX[1], y: y - 12 * i, size: 9.5, font: f.bold, color: INK }));
  let by = y - 12 * nameLines.length - 1;
  for (const raw of billLines) for (const l of wrap(raw, f.reg, 8.5, 158)) { page.drawText(l, { x: colX[1], y: by, size: 8.5, font: f.reg, color: SOFT }); by -= 13; }

  const details: [string, string][] = [
    [isInvoice ? "Invoice no." : "Quote no.", doc.number],
    ["Date", longDate(doc.issue_date)],
    isInvoice ? ["Terms", doc.due_date ? `Due ${longDate(doc.due_date)}` : "Due on receipt"] : ["Valid until", doc.due_date ? longDate(doc.due_date) : "30 days"],
  ];
  if (doc.po_number) details.push(["PO number", doc.po_number]);
  if (doc.vehicle_reg) details.push(["Reg", doc.vehicle_reg]);
  details.forEach(([k, v], i) => {
    const ly = y - 14 * i;
    page.drawText(k, { x: colX[2], y: ly, size: 8.5, font: f.reg, color: SOFT });
    spaced(page, v, W - M, ly, 8.5, f.reg, INK, 0, "right");
    page.drawLine({ start: { x: colX[2], y: ly - 4.5 }, end: { x: W - M, y: ly - 4.5 }, thickness: 0.4, color: LINE });
  });
  y = Math.min(y - 13 * (from.length + 1), by, y - 14 * details.length) - 22;

  // ---- line items ----
  const tableHead = (yy: number) => {
    label(page, f, "Description", COLS.desc, yy);
    label(page, f, "Qty", COLS.qty, yy, "right");
    label(page, f, "Price", COLS.price, yy, "right");
    label(page, f, "Amount", COLS.amount, yy, "right");
    page.drawLine({ start: { x: M, y: yy - 7 }, end: { x: W - M, y: yy - 7 }, thickness: 0.6, color: INK });
    return yy - 24;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    header(page, f, doc);
    return tableHead(H - 156);
  };
  y = tableHead(y);
  const groups: [PdfLine["kind"], string][] = [["part", "Parts"], ["labour", "Labour"], ["other", "Other"]];
  const used = groups.filter(([k]) => doc.lines.some(l => l.kind === k));
  for (const [kind, title] of used) {
    if (y < 150) y = newPage();
    if (used.length > 1 || kind !== "other") {
      label(page, f, doc.vehicle_reg && kind === "part" ? `${doc.vehicle_reg} · ${title}` : title, COLS.desc, y);
      y -= 15;
    }
    for (const l of doc.lines.filter(x => x.kind === kind)) {
      const descLines = wrap(l.description, f.bold, 9, COLS.qty - COLS.desc - 60);
      const rowH = 11 * descLines.length + 4;
      if (y - rowH < 110) y = newPage();
      descLines.forEach((d, i) => page.drawText(d, { x: COLS.desc, y: y - 11 * i, size: 9, font: f.bold, color: INK }));
      spaced(page, qtyLabel(l.qty, l.unit), COLS.qty, y, 9, f.reg, INK, 0, "right");
      spaced(page, gbp(l.unit_pence), COLS.price, y, 9, f.reg, INK, 0, "right");
      spaced(page, gbp(lineTotal(l)), COLS.amount, y, 9, f.reg, INK, 0, "right");
      y -= rowH;
      page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: LINE });
      y -= 3;
    }
    y -= 6;
  }

  // ---- totals and how to pay ----
  const t = totals(doc.lines, doc.paid_pence);
  const notesLines = doc.notes ? wrap(doc.notes, f.reg, 8.5, W - 2 * M) : [];
  const blockH = 108 + (notesLines.length ? 22 + notesLines.length * 12 : 0);
  if (y - blockH < 60) { page = pdf.addPage([W, H]); header(page, f, doc); y = H - 156; }

  const tx = 330;
  let ty = y - 4;
  const parts = [t.parts ? `Parts ${gbp(t.parts)}` : "", t.labour ? `Labour ${gbp(t.labour)}` : "", t.other ? `Other ${gbp(t.other)}` : ""].filter(Boolean);
  if (parts.length > 1) { page.drawText(pdfSafe(parts.join("  ·  ")), { x: tx, y: ty, size: 7.5, font: f.reg, color: FAINT }); ty -= 22; }
  const row = (k: string, v: string, size = 9.5, font = f.reg, color = INK) => {
    page.drawText(k, { x: tx, y: ty, size, font, color });
    spaced(page, v, W - M, ty, size, font, color, 0, "right");
    ty -= size + 10;
  };
  row("Total", gbp(t.total));
  if (isInvoice && t.paid) row(t.paid >= t.total ? "Paid" : "Paid (deposit)", `-${gbp(t.paid)}`, 9.5, f.reg, SOFT);
  page.drawLine({ start: { x: tx, y: ty + 4 }, end: { x: W - M, y: ty + 4 }, thickness: 0.8, color: INK });
  ty -= 12;
  if (isInvoice) {
    if (t.balance <= 0) row("Paid in full - thank you", gbp(0), 12, f.bold);
    else row("Balance due", gbp(t.balance), 15, f.bold);
  } else row("Quote total", gbp(t.total), 15, f.bold);

  // How to pay (invoices) or how to accept (quotes), in a soft box on the left.
  const bx = M, bw = 262, bh = isInvoice && t.balance > 0 ? 104 : 64, btop = y + 2;
  page.drawRectangle({ x: bx, y: btop - bh, width: bw, height: bh, borderColor: LINE, borderWidth: 0.8, color: rgb(0.985, 0.988, 0.99) });
  let py = btop - 15;
  label(page, f, isInvoice ? "How to pay" : "How to accept", bx + 14, py);
  py -= 14;
  const intro = isInvoice
    ? t.balance <= 0 ? "Nothing more to pay. Thank you." : `Balance of ${gbp(t.balance)} ${doc.due_date ? `due by ${longDate(doc.due_date)}` : "due on receipt"}. Please pay by bank transfer, quoting ${doc.number} as the reference.`
    : `Reply to our email or call ${b.phone} to book. Prices are held until ${doc.due_date ? longDate(doc.due_date) : "30 days from the date above"}.`;
  for (const l of wrap(intro, f.reg, 8.5, bw - 28)) { page.drawText(l, { x: bx + 14, y: py, size: 8.5, font: f.reg, color: INK }); py -= 12; }
  if (isInvoice && t.balance > 0) {
    py -= 2;
    if (b.bank) {
      label(page, f, "Account name", bx + 14, py);
      page.drawText(pdfSafe(b.bank.name), { x: bx + 14, y: py - 11, size: 8.5, font: f.mono, color: INK });
      const cells: [string, string][] = [["Sort code", b.bank.sortCode], ["Account no.", b.bank.account], ["Reference", doc.number]];
      cells.forEach(([k, v], i) => {
        const cx = bx + 14 + i * 80, cy = py - 25;
        label(page, f, k, cx, cy);
        page.drawText(pdfSafe(v), { x: cx, y: cy - 11, size: 8.5, font: f.mono, color: INK });
      });
    } else {
      page.drawText(`Call ${b.phone} for payment details.`, { x: bx + 14, y: py, size: 8.5, font: f.reg, color: SOFT });
    }
  }

  // Notes, full width under the totals.
  if (notesLines.length) {
    let ny = Math.min(btop - bh, ty) - 22;
    label(page, f, "Notes", M, ny);
    ny -= 14;
    for (const l of notesLines) { page.drawText(l, { x: M, y: ny, size: 8.5, font: f.reg, color: SOFT }); ny -= 12; }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => footer(p, f, b, i + 1, pages.length));
  return pdf.save();
}
