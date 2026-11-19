// Instant alerts to the workshop's own inbox ("[BOOKING] CP-1001 · ..."), sent through Cloudflare
// Email Routing's send_email binding. That binding only delivers to the verified destination in
// wrangler.toml, which is exactly what staff alerts need; customer emails go through the outbox.
import type { Env } from "../../lib/env";

export type AlertKind = "BOOKING" | "LEAD" | "JOB";

export interface StaffAlert {
  kind: AlertKind;
  /** Parts after the tag, joined with " · " (e.g. ref, name, service, reg). Empty parts are dropped. */
  subject: (string | null | undefined)[];
  /** Body lines as [label, value]; empty values are dropped. */
  lines: [string, string | null | undefined][];
  link: string;
  replyTo?: string | null;
  /** Button text in the HTML email, e.g. "Open job". */
  button?: string;
}

const FROM = (env: Env) => ({ name: "Curve Hub", email: `hub@${new URL(env.SITE_ORIGIN).hostname}` });

export function alertSubject(a: Pick<StaffAlert, "kind" | "subject">): string {
  const parts = a.subject.map(s => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return `[${a.kind}] ${parts.join(" · ")}`.slice(0, 200);
}

export function alertText(a: Pick<StaffAlert, "lines" | "link">): string {
  const rows = a.lines.filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => `${k}: ${String(v).trim()}`);
  return `${rows.join("\n")}\n\nOpen in Curve Hub: ${a.link}\n`;
}

const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The same alert as a small HTML email with an "Open in Curve Hub" button. */
export function alertHtml(a: Pick<StaffAlert, "kind" | "subject" | "lines" | "link"> & { button?: string }): string {
  const rows = a.lines.filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#5a636e;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#0b0e12;white-space:pre-wrap">${esc(String(v).trim())}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:20px 12px;background:#f3f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e7eb;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b0e12;color:#e9eef4;padding:14px 20px;font-size:13px;letter-spacing:.24em"><b>CURVE</b> HUB · ${esc(a.kind)}</td></tr>
<tr><td style="padding:18px 20px 6px;font-size:17px;font-weight:600;color:#0b0e12">${esc(alertSubject(a).replace(/^\[[A-Z]+\] /, ""))}</td></tr>
<tr><td style="padding:0 20px 8px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
<tr><td style="padding:8px 20px 22px"><a href="${esc(a.link)}" style="display:inline-block;background:#0b0e12;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(a.button || "Open in Curve Hub")}</a></td></tr>
</table></body></html>`;
}

/** Sends one alert. Never throws: an alert that can't be sent must not break the booking or lead that triggered it. */
export async function sendStaffAlert(env: Env, a: StaffAlert): Promise<boolean> {
  if (!env.STAFF_MAIL || !env.STAFF_ALERT_TO) return false;
  try {
    await env.STAFF_MAIL.send({
      from: FROM(env),
      to: env.STAFF_ALERT_TO,
      subject: alertSubject(a),
      text: alertText(a),
      html: alertHtml(a),
      ...(a.replyTo ? { replyTo: a.replyTo } : {}),
      headers: { "X-Curve-Alert": a.kind.toLowerCase() },
    });
    return true;
  } catch (err) {
    console.warn("staff alert not sent", a.kind, err);
    return false;
  }
}
