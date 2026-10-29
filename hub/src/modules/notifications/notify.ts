// notify(): the one way modules tell the owners something happened. It writes an inbox row for
// each person who should hear about it and sends a phone push to their devices. It never throws:
// a notification that fails must not break the booking, job or lead that triggered it.
import type { Env, Lang } from "../../lib/env";
import { all, newId, now, run } from "../../lib/db";
import { isLocal } from "../../lib/session";
import { GROUP_OF, renderNotification, type NotifyKind } from "./texts";
import { isAllowedEndpoint, sendPush, type VapidKeys } from "./webpush";

export interface NotifyEvent {
  kind: NotifyKind;
  /** Who did it (they aren't notified). Null for the website, the scheduled jobs and other system events. */
  actorId: string | null;
  /** Dashboard route to open, e.g. "#/jobs/job_123". */
  link: string;
  /** Plain-text values for the message (ref, name, service, reg, title, note, platform, ...). */
  params?: Record<string, string | null | undefined>;
  /** Only this user (e.g. the person a job was assigned to). */
  onlyUserId?: string;
  /** Groups phone notifications about the same record, so an update replaces the old one. */
  tag?: string;
}

export interface Recipient { id: string; lang: Lang }

const MAX_DEVICES_PER_EVENT = 20;

/** Who hears about an event: everyone except the person who did it, or just `onlyUserId`; minus anyone who switched that group off. */
export function recipientsFor(users: Recipient[], e: Pick<NotifyEvent, "kind" | "actorId" | "onlyUserId">, disabled: Set<string>): Recipient[] {
  const group = GROUP_OF[e.kind];
  const wanted = (u: Recipient) => e.onlyUserId
    ? u.id === e.onlyUserId && (e.kind === "test" || u.id !== e.actorId) // nobody is told about their own assignment
    : u.id !== e.actorId;
  return users.filter(u => wanted(u) && !(group && disabled.has(`${u.id}:${group}`)));
}

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:info@curveperformance.co.uk" };
}

interface SubRow { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

/** Pushes one event's notifications to the recipients' devices. Returns how many devices accepted it. */
async function deliver(env: Env, rows: { userId: string; lang: Lang; id: string; title: string; body: string }[], e: NotifyEvent): Promise<number> {
  const keys = vapidKeys(env);
  if (!keys || !rows.length) return 0;
  const byUser = new Map(rows.map(r => [r.userId, r]));
  const marks = rows.map(() => "?").join(",");
  const subs = await all<SubRow>(env, `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${marks}) ORDER BY created_at DESC LIMIT ?`,
    ...rows.map(r => r.userId), MAX_DEVICES_PER_EVENT);
  const allowLocal = isLocal(env);
  const results = await Promise.all(subs.map(async s => {
    const r = byUser.get(s.user_id)!;
    if (!isAllowedEndpoint(s.endpoint, allowLocal)) return "skip" as const;
    try {
      const outcome = await sendPush(s, { id: r.id, title: r.title, body: r.body, url: `/app/${e.link}`, tag: e.tag ?? e.kind }, keys, { urgency: e.kind === "test" ? "high" : "normal" });
      if (outcome === "gone") await run(env, "DELETE FROM push_subscriptions WHERE id = ?", s.id);
      if (outcome === "ok") await run(env, "UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?", now(), s.id);
      return outcome;
    } catch (err) {
      console.warn("push failed", err);
      return "error" as const;
    }
  }));
  return results.filter(x => x === "ok").length;
}

/**
 * Records and sends an event's notifications. Pass the request's ExecutionContext when there is one,
 * so phone delivery happens after the response; otherwise delivery is awaited for at most a few seconds.
 */
export async function notify(env: Env, e: NotifyEvent, exec?: ExecutionContext): Promise<{ inbox: number; pushed?: number }> {
  try {
    const users = await all<Recipient>(env, "SELECT id, lang FROM users");
    const group = GROUP_OF[e.kind];
    const off = group ? await all<{ user_id: string }>(env, "SELECT user_id FROM notification_prefs WHERE kind = ? AND enabled = 0", group) : [];
    const recipients = recipientsFor(users, e, new Set(off.map(o => `${o.user_id}:${group}`)));
    if (!recipients.length) return { inbox: 0 };

    const params = Object.fromEntries(Object.entries(e.params ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v).slice(0, 500)]));
    const titleKey = `${e.kind}.title`, bodyKey = `${e.kind}.body`, t = now();
    const rows = recipients.map(u => ({ userId: u.id, lang: u.lang, id: newId("ntf"), ...renderNotification(titleKey, bodyKey, params, u.lang) }));
    await env.DB.batch(rows.map(r => env.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, title_key, body_key, params_json, link, tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(r.id, r.userId, e.kind, titleKey, bodyKey, JSON.stringify(params), e.link, e.tag ?? null, t)));

    const sending = deliver(env, rows, e).catch(err => { console.warn("push delivery failed", err); return 0; });
    if (exec) { exec.waitUntil(sending); return { inbox: rows.length }; }
    const pushed = await Promise.race([sending, new Promise<number>(r => setTimeout(() => r(-1), 4000))]);
    return { inbox: rows.length, pushed };
  } catch (err) {
    console.error("notify failed", e.kind, err);
    return { inbox: 0 };
  }
}
