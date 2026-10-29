// Notifications: the in-app inbox, phone push subscriptions and each person's choices, plus the
// outbox of customer messages (booking confirmations, reminders) that wait for a provider.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import type { Env, Lang } from "../../lib/env";
import { all, first, newId, now, run } from "../../lib/db";
import { badRequest, json } from "../../lib/http";
import { isLocal } from "../../lib/session";
import { notify, vapidKeys } from "./notify";
import { PREF_GROUPS, renderNotification, type PrefGroup } from "./texts";
import { b64urlDecode, isAllowedEndpoint } from "./webpush";

export { notify } from "./notify";

export type Channel = "email" | "whatsapp" | "sms";

export interface QueuedMessage {
  channel: Channel;
  to: string;
  template: string;                  // e.g. 'booking.received', 'booking.confirmed'
  payload: Record<string, unknown>;
  entity?: string;
  entityId?: string;
}

export async function queueMessage(env: Env, msg: QueuedMessage): Promise<string> {
  const id = newId("msg");
  await run(
    env,
    "INSERT INTO outbox (id, channel, to_addr, template, payload_json, entity, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, msg.channel, msg.to, msg.template, JSON.stringify(msg.payload), msg.entity ?? null, msg.entityId ?? null, now(),
  );
  return id;
}

async function outbox(ctx: Ctx) {
  const status = ctx.url.searchParams.get("status");
  const rows = status
    ? await all(ctx.env, "SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC LIMIT 100", status)
    : await all(ctx.env, "SELECT * FROM outbox ORDER BY created_at DESC LIMIT 100");
  return json({ messages: rows });
}

// ---------- push subscriptions ----------
const MAX_DEVICES_PER_USER = 10;

async function config(ctx: Ctx) {
  const keys = vapidKeys(ctx.env);
  return json({ publicKey: keys?.publicKey ?? null, push: !!keys });
}

function readSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } {
  const b = (body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
  const p256dh = typeof b.keys?.p256dh === "string" ? b.keys.p256dh : "";
  const auth = typeof b.keys?.auth === "string" ? b.keys.auth : "";
  let ok = endpoint.length <= 1000 && p256dh.length <= 200 && auth.length <= 100;
  try { ok = ok && b64urlDecode(p256dh).length === 65 && b64urlDecode(auth).length === 16; } catch { ok = false; }
  if (!ok || !endpoint) throw badRequest("That isn't a push subscription this Hub can use.");
  return { endpoint, p256dh, auth };
}

async function subscribe(ctx: Ctx) {
  const { env } = ctx;
  const user = userOf(ctx);
  const s = readSubscription(await ctx.body());
  if (!isAllowedEndpoint(s.endpoint, isLocal(env))) throw badRequest("That isn't a push subscription this Hub can use.");
  const t = now();
  await run(env,
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    newId("psb"), user.id, s.endpoint, s.p256dh, s.auth, (ctx.req.headers.get("user-agent") || "").slice(0, 300), t);
  // Keep each person's newest devices only.
  await run(env, `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`,
    user.id, user.id, MAX_DEVICES_PER_USER);
  const { n } = (await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?", user.id))!;
  return json({ ok: true, devices: n }, 201);
}

async function unsubscribe(ctx: Ctx) {
  const user = userOf(ctx);
  const b = (await ctx.body()) as { endpoint?: unknown };
  if (typeof b?.endpoint !== "string") throw badRequest("That isn't a push subscription this Hub can use.");
  await run(ctx.env, "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", user.id, b.endpoint);
  return json({ ok: true });
}

// ---------- inbox ----------
interface NotificationRow { id: string; kind: string; title_key: string; body_key: string; params_json: string; link: string; created_at: string; read_at: string | null }

async function list(ctx: Ctx) {
  const user = userOf(ctx);
  const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit")) || 30, 1), 100);
  const rows = await all<NotificationRow>(ctx.env, "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?", user.id, limit);
  const { n } = (await first<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id))!;
  const lang: Lang = user.lang;
  return json({
    unread: n,
    notifications: rows.map(r => {
      let params: Record<string, string> = {};
      try { params = JSON.parse(r.params_json); } catch {}
      return { id: r.id, kind: r.kind, link: r.link, created_at: r.created_at, read_at: r.read_at, ...renderNotification(r.title_key, r.body_key, params, lang) };
    }),
  });
}

async function markRead(ctx: Ctx) {
  const user = userOf(ctx);
  const b = (await ctx.body()) as { ids?: unknown; all?: unknown };
  const t = now();
  if (b?.all === true) {
    await run(ctx.env, "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", t, user.id);
  } else {
    const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is string => typeof x === "string" && /^ntf_[a-z0-9]{6,40}$/.test(x)).slice(0, 100) : [];
    if (!ids.length) throw badRequest("Choose which notifications to mark as read.");
    await run(ctx.env, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`, t, user.id, ...ids);
  }
  const { n } = (await first<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", user.id))!;
  return json({ unread: n });
}

// ---------- choices ----------
async function readPrefs(env: Env, userId: string): Promise<Record<PrefGroup, boolean>> {
  const rows = await all<{ kind: string; enabled: number }>(env, "SELECT kind, enabled FROM notification_prefs WHERE user_id = ?", userId);
  const off = new Set(rows.filter(r => !r.enabled).map(r => r.kind));
  return Object.fromEntries(PREF_GROUPS.map(g => [g, !off.has(g)])) as Record<PrefGroup, boolean>;
}

async function getPrefs(ctx: Ctx) {
  return json({ prefs: await readPrefs(ctx.env, userOf(ctx).id) });
}

async function putPrefs(ctx: Ctx) {
  const user = userOf(ctx);
  const b = (await ctx.body()) as { prefs?: Record<string, unknown> };
  const entries = Object.entries(b?.prefs ?? {}).filter(([k, v]) => (PREF_GROUPS as readonly string[]).includes(k) && typeof v === "boolean");
  if (!entries.length) throw badRequest("Choose which notifications to change.");
  await ctx.env.DB.batch(entries.map(([k, v]) => ctx.env.DB.prepare(
    "INSERT INTO notification_prefs (user_id, kind, enabled) VALUES (?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled",
  ).bind(user.id, k, v ? 1 : 0)));
  return json({ prefs: await readPrefs(ctx.env, user.id) });
}

async function test(ctx: Ctx) {
  const user = userOf(ctx);
  const r = await notify(ctx.env, { kind: "test", actorId: user.id, onlyUserId: user.id, link: "#/settings", tag: "test" });
  const { n } = (await first<{ n: number }>(ctx.env, "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?", user.id))!;
  return json({ ok: true, devices: n, delivered: Math.max(r.pushed ?? 0, 0), push: !!vapidKeys(ctx.env) });
}

const notifications: Module = {
  name: "notifications",
  register(r) {
    r.get("/api/notifications/outbox", outbox);
    r.get("/api/notifications/config", config);
    r.post("/api/notifications/subscriptions", subscribe);
    r.delete("/api/notifications/subscriptions", unsubscribe);
    r.get("/api/notifications", list);
    r.post("/api/notifications/read", markRead);
    r.get("/api/notifications/prefs", getPrefs);
    r.put("/api/notifications/prefs", putPrefs);
    r.post("/api/notifications/test", test);
  },
  // Keep the inbox short: notifications older than 90 days are removed.
  async scheduled(env) {
    await run(env, "DELETE FROM notifications WHERE created_at < ?", new Date(Date.now() - 90 * 864e5).toISOString());
  },
};
export default notifications;
