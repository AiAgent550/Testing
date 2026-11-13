// Customer email layout: the message as typed, a button for the private photo/video link, and the business footer.
// Pure functions so they can be tested without sending anything.

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Turns bare web addresses into links (the message is escaped first, so only real URLs become links). */
const linkify = (html: string) => html.replace(/\bhttps:\/\/[^\s<]+[^\s<.,;:!?)]/g, u => `<a href="${u}" style="color:#0b0e12">${u}</a>`);

export interface Composed { text: string; html: string }

export function composeEmail(opts: {
  message: string;
  link?: { url: string; count: number; expires: string } | null;
  attachmentNames?: string[];
  business: { tradingName: string; phone: string; email: string; website: string; legal: string };
}): Composed {
  const b = opts.business;
  const msg = opts.message.replace(/\r\n/g, "\n").trim();
  const linkText = opts.link
    ? `Photos and videos from your job (${opts.link.count}): ${opts.link.url}\nThis private link works until ${opts.link.expires}.`
    : "";
  const text = [msg, linkText, `--\n${b.tradingName}\n${b.phone} · ${b.email}\n${b.website}`].filter(Boolean).join("\n\n");

  const paras = msg.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");
  const button = opts.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="background:#0b0e12;border-radius:8px">
<a href="${esc(opts.link.url)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:600;letter-spacing:.02em">View photos and videos (${opts.link.count})</a></td></tr></table>
<p style="margin:0 0 14px;color:#5a636e;font-size:13px">This private link works until ${esc(opts.link.expires)}.</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b0e12;font-size:15px;line-height:1.55">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e7eb">
<tr><td style="background:#0b0e12;padding:18px 24px;color:#e9eef4;font-size:15px;letter-spacing:.28em"><b>CURVE</b> PERFORMANCE</td></tr>
<tr><td style="padding:24px">${paras}${button}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e3e7eb;font-size:12px;color:#5a636e">
<b style="color:#0b0e12">${esc(b.tradingName)}</b> · ${esc(b.phone)} · <a href="mailto:${esc(b.email)}" style="color:#5a636e">${esc(b.email)}</a> · <a href="https://${esc(b.website)}" style="color:#5a636e">${esc(b.website)}</a><br>${esc(b.legal)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export type PhotoChoice = { id: string; kind: "photo" | "video"; bytes: number };

/** Splits the chosen files into email attachments and the private link: videos always go by link, photos are attached
 *  until the budget is used, the rest go by link. */
export function planAttachments(files: PhotoChoice[], budget: number, maxCount = 20): { attach: string[]; link: string[] } {
  const attach: string[] = [], link: string[] = [];
  let used = 0;
  for (const f of files) {
    if (f.kind === "photo" && attach.length < maxCount && used + f.bytes <= budget) { attach.push(f.id); used += f.bytes; }
    else link.push(f.id);
  }
  return { attach, link };
}
