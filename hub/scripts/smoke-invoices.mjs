// End-to-end checks for job videos, photo previews, invoices and quotes, PDFs, customer emails and the private
// photo/video link page. Uses the job seed rows from test/fixtures/jobs-seed.sql.
import { anon, checker, signIn } from "./hubclient.mjs";

const { check, done } = checker("invoices");
const call = await signIn();

// ---- a job to work on ----
const job = await call("/api/jobs", { method: "POST", body: { title: "Timing belt and water pump", reg: "GRZ6348" } });
check("job created", job.status === 201, job.data);
const J = job.data.job.id;

// ---- videos ----
const mp4 = new Uint8Array(4096);
mp4.set([0, 0, 0, 24, ...Buffer.from("ftypmp42")], 0);
const vid = await call(`/api/jobs/${J}/videos`, { method: "POST", body: new Blob([mp4]), headers: { "content-type": "video/mp4", "x-file-name": encodeURIComponent("dash cam.mp4") } });
check("video uploads", vid.status === 201 && vid.data.file.kind === "video" && vid.data.file.size === 4096, vid.data);
const fake = await call(`/api/jobs/${J}/videos`, { method: "POST", body: new Blob([Buffer.from("not a video at all, just text pretending")]), headers: { "content-type": "video/mp4" } });
check("non-video refused", fake.status === 415, fake.data);
const range = await call(vid.data.file.url, { headers: { range: "bytes=0-99" } });
check("video served in ranges", range.status === 206 && range.res.headers.get("content-range") === "bytes 0-99/4096", range.status);

// ---- photo with a phone-made preview ----
const jpeg = new Uint8Array(2048); jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
const prev = new Uint8Array(512); prev.set([0xff, 0xd8, 0xff, 0xe0], 0);
const fd = new FormData();
fd.append("file", new Blob([jpeg], { type: "image/jpeg" }), "IMG_0001.jpg");
fd.append("preview", new Blob([prev], { type: "image/jpeg" }), "preview.jpg");
const photo = await call(`/api/jobs/${J}/files`, { method: "POST", body: fd });
check("photo with preview uploads", photo.status === 201 && photo.data.file.thumb_url?.endsWith("?v=preview") && photo.data.file.preview_size === 512, photo.data);
const thumb = await call(photo.data.file.thumb_url);
check("preview served", thumb.status === 200 && Number(thumb.res.headers.get("content-length")) === 512);
const detail = await call(`/api/jobs/${J}`);
check("job lists both files without storage keys", detail.data.files.length === 2 && !JSON.stringify(detail.data.files).includes("r2_key") && !JSON.stringify(detail.data.files).includes("preview_key"));

// ---- invoices ----
const pre = await call(`/api/documents/prefill/${J}`);
check("prefill from job", pre.status === 200 && pre.data.vehicle_reg === "GRZ6348", pre.data);
const lines = [
  { kind: "part", description: "Timing belt kit + water pump", qty: 1, unit_pence: 27216, cost_pence: 24300, markup_pct: 12 },
  { kind: "part", description: "Engine oil", qty: 5, unit: "L", unit_pence: 900 },
  { kind: "labour", description: "Labour", qty: 1, unit_pence: 51000 },
];
const inv = await call("/api/documents", { method: "POST", body: { kind: "invoice", job_id: J, bill_name: "Private customer", bill_email: "customer@example.com", vehicle_reg: "grz6348", po_number: "PO31543", paid_pence: 10000, lines } });
check("invoice created as INV-1050", inv.status === 201 && inv.data.document.number === "INV-1050", inv.data);
check("totals and balance", inv.data.document.total_pence === 82716 && inv.data.document.balance_pence === 72716, inv.data.document);
const I = inv.data.document.id;
const bad = await call("/api/documents", { method: "POST", body: { kind: "invoice", bill_name: "X", lines: [{ description: "", unit_pence: 1 }] } });
check("line without description refused", bad.status === 400);

const pdf = await call(`/api/documents/${I}/pdf`);
const pdfBytes = new Uint8Array(await pdf.res.arrayBuffer());
check("PDF renders", pdf.status === 200 && pdf.res.headers.get("content-type") === "application/pdf" && Buffer.from(pdfBytes.slice(0, 5)).toString() === "%PDF-", pdf.status);

const upd = await call(`/api/documents/${I}`, { method: "PATCH", body: { lines: [...lines, { kind: "other", description: "Disposal", unit_pence: 500 }] } });
check("invoice updated", upd.status === 200 && upd.data.document.total_pence === 83216, upd.data);
const list = await call("/api/documents?kind=invoice&filter=open");
check("invoice listed", list.data.documents.some(d => d.id === I));

// ---- quotes ----
const quo = await call("/api/documents", { method: "POST", body: { kind: "quote", job_id: J, bill_name: "Private customer", lines: lines.slice(0, 1) } });
check("quote created as QUO-1001 with a 30-day validity", quo.status === 201 && quo.data.document.number === "QUO-1001" && !!quo.data.document.due_date, quo.data);
const conv = await call(`/api/documents/${quo.data.document.id}/convert`, { method: "POST" });
check("quote turned into INV-1051", conv.status === 201 && conv.data.document.number === "INV-1051" && conv.data.document.total_pence === 27216, conv.data);
const again = await call(`/api/documents/${quo.data.document.id}/convert`, { method: "POST" });
check("converting twice returns the same invoice", again.status === 200 && again.data.document.id === conv.data.document.id);
const delOld = await call(`/api/documents/${I}`, { method: "DELETE" });
check("an older draft can't be deleted (numbers stay in order)", delOld.status === 409, delOld.data);
const delNew = await call(`/api/documents/${conv.data.document.id}`, { method: "DELETE" });
check("the newest draft can be deleted", delNew.status === 200, delNew.data);
const next = await call("/api/documents", { method: "POST", body: { kind: "invoice", bill_name: "Next", lines: lines.slice(2) } });
check("its number is reused", next.data.document.number === "INV-1051", next.data.document?.number);

// ---- email (local Email Service simulator) ----
const st = await call("/api/mail/status");
check("mail status", st.status === 200 && st.data.available === true, st.data);
const send = await call("/api/mail/send", { method: "POST", body: {
  purpose: "invoice", to: "customer@example.com", subject: "Invoice INV-1050", message: "Hi,\n\nInvoice attached.\n\nThanks",
  job_id: J, document_ids: [I], file_ids: [vid.data.file.id, photo.data.file.id],
} });
check("email sent", send.status === 201 && send.data.email.attachments.length === 2 && /\/r\/[0-9a-f]{48}$/.test(send.data.email.link || ""), send.data);
const sentDoc = await call(`/api/documents/${I}`);
check("invoice marked sent and email logged", sentDoc.data.document.status === "sent" && sentDoc.data.emails.length === 1, sentDoc.data);
const log = await call(`/api/mail?job_id=${J}`);
check("email listed on the job", log.data.emails.length === 1 && log.data.emails[0].attachments.length === 2);

// ---- the customer's link page ----
const path = new URL(send.data.email.link).pathname;
const page = await anon(path);
const html = await page.res.text();
check("link page opens without signing in", page.status === 200 && html.includes("<video") && html.includes("Photos and videos"), page.status);
const vidPath = html.match(/src="(\/r\/[0-9a-f]+\/f\/[^"]+)"/)?.[1];
const media = await anon(vidPath, { headers: { range: "bytes=0-9" } });
check("video plays from the link", media.status === 206, media.status);
const other = await anon(`${path}/f/${photo.data.file.id}x`);
check("files not in the link are refused", other.status === 404);
const wrong = await anon("/r/" + "0".repeat(48));
check("unknown link shows expired page", wrong.status === 404);

// ---- paying ----
const paid = await call(`/api/documents/${I}/status`, { method: "POST", body: { status: "paid" } });
check("marked paid", paid.data.document.status === "paid" && paid.data.document.balance_pence === 0, paid.data);
const reopen = await call(`/api/documents/${I}`, { method: "PATCH", body: { paid_pence: 5000 } });
check("lowering the payment re-opens it", reopen.data.document.status === "sent", reopen.data.document.status);

// ---- clean-up of files ----
const delVid = await call(`/api/jobs/${J}/files/${vid.data.file.id}`, { method: "DELETE" });
check("video deleted", delVid.status === 200);

done();
