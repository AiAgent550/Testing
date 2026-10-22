// Instant alerts to the workshop's own inbox ("[BOOKING] CP-1001 · ..."), sent through Cloudflare
// Email Routing's send_email binding. That binding only delivers to the verified destination in
// wrangler.toml, which is exactly what staff alerts need; customer emails go through the outbox.
import type { Env } from "../../lib/env";

export type AlertKind = "BOOKING" | "LEAD";

export interface StaffAlert {
  kind: AlertKind;
  /** Parts after the tag, joined with " · " (e.g. ref, name, service, reg). Empty parts are dropped. */
  subject: (string | null | undefined)[];
  /** Body lines as [label, value]; empty values are dropped. */
  lines: [string, string | null | undefined][];
  link: string;
  replyTo?: string | null;
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

/** Sends one alert. Never throws: an alert that can't be sent must not break the booking or lead that triggered it. */
export async function sendStaffAlert(env: Env, a: StaffAlert): Promise<boolean> {
  if (!env.STAFF_MAIL || !env.STAFF_ALERT_TO) return false;
  try {
    await env.STAFF_MAIL.send({
      from: FROM(env),
      to: env.STAFF_ALERT_TO,
      subject: alertSubject(a),
      text: alertText(a),
      ...(a.replyTo ? { replyTo: a.replyTo } : {}),
      headers: { "X-Curve-Alert": a.kind.toLowerCase() },
    });
    return true;
  } catch (err) {
    console.warn("staff alert not sent", a.kind, err);
    return false;
  }
}
