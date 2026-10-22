// Health, dashboard overview, audit trail, business settings and which integrations are connected.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, first, run } from "../../lib/db";
import { json, notFound } from "../../lib/http";
import { prune } from "../../lib/ratelimit";
import { parse, str } from "../../lib/validate";

/** Business settings the dashboard can edit, with their defaults. */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  business: { name: "Curve Performance", phone: "", email: "", address: "", instagram: "" },
  hours: { mon: "08:00-18:00", tue: "08:00-18:00", wed: "08:00-18:00", thu: "08:00-18:00", fri: "08:00-18:00", sat: "09:00-14:00", sun: "" },
  booking: { slotMinutes: 120, leadTimeHours: 24, mobileRadiusMiles: 25 },
};

export async function getSetting<T>(env: Ctx["env"], key: string): Promise<T> {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", key);
  return (row ? JSON.parse(row.value) : SETTING_DEFAULTS[key]) as T;
}

async function health(ctx: Ctx) {
  const ok = await first<{ ok: number }>(ctx.env, "SELECT 1 AS ok");
  return json({ ok: ok?.ok === 1, service: "curve-hub" });
}

async function overview(ctx: Ctx) {
  const { env } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const [requested, todayBookings, openJobs, newLeads] = await Promise.all([
    first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'"),
    first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM bookings WHERE status IN ('confirmed','in_progress') AND substr(scheduled_start, 1, 10) = ?", today),
    first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('open','in_progress','waiting_parts')"),
    first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM leads WHERE status = 'new'"),
  ]);
  return json({
    counts: { requested: requested?.n ?? 0, today: todayBookings?.n ?? 0, openJobs: openJobs?.n ?? 0, newLeads: newLeads?.n ?? 0 },
    user: { name: userOf(ctx).name },
  });
}

async function auditList(ctx: Ctx) {
  const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit") || 50)));
  const entity = ctx.url.searchParams.get("entity"), id = ctx.url.searchParams.get("entity_id");
  const rows = entity && id
    ? await all(ctx.env, `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE entity = ? AND entity_id = ? ORDER BY a.id DESC LIMIT ?`, entity, id, limit)
    : await all(ctx.env, `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, limit);
  return json({ entries: rows });
}

async function getSettingRoute(ctx: Ctx) {
  const key = ctx.params.key;
  if (!(key in SETTING_DEFAULTS)) throw notFound("Setting");
  return json({ key, value: await getSetting(ctx.env, key) });
}

async function putSetting(ctx: Ctx) {
  const key = ctx.params.key;
  if (!(key in SETTING_DEFAULTS)) throw notFound("Setting");
  const body = (await ctx.body()) as { value?: unknown };
  const { value } = parse({ value: JSON.stringify(body.value ?? null) }, { value: str({ max: 8000 }) });
  await run(ctx.env, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  await audit(ctx.env, userOf(ctx).id, "settings.update", "setting", key);
  return json({ key, value: JSON.parse(value) });
}

async function integrations(ctx: Ctx) {
  const e = ctx.env;
  return json({
    integrations: [
      { key: "encryption", label: "Encryption key", connected: !!e.ENCRYPTION_KEY },
      { key: "dvla", label: "DVLA vehicle lookup", connected: !!e.DVLA_API_KEY },
      { key: "dvsa", label: "DVSA MOT history", connected: !!(e.DVSA_CLIENT_ID && e.DVSA_CLIENT_SECRET && e.DVSA_API_KEY) },
      { key: "ai", label: "Claude AI", connected: !!e.ANTHROPIC_API_KEY },
      { key: "meta", label: "Instagram and Facebook", connected: !!(e.META_APP_ID && e.META_APP_SECRET) },
      { key: "youtube", label: "YouTube", connected: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) },
      { key: "tiktok", label: "TikTok", connected: !!(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET) },
    ],
  });
}

const system: Module = {
  name: "system",
  register(r) {
    r.get("/api/system/health", health, "public");
    r.get("/api/system/overview", overview);
    r.get("/api/system/audit", auditList);
    r.get("/api/system/integrations", integrations);
    r.get("/api/settings/:key", getSettingRoute);
    r.put("/api/settings/:key", putSetting);
  },
  async scheduled(env) {
    await prune(env);
    await run(env, "DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
  },
};
export default system;
