// Outgoing messages (booking confirmations, reminders). Modules queue messages here;
// the scheduled trigger sends them once a provider is connected. Until then they stay
// queued and are visible on the dashboard, so nothing is silently lost.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import type { Env } from "../../lib/env";
import { all, newId, now, run } from "../../lib/db";
import { json } from "../../lib/http";

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

async function list(ctx: Ctx) {
  const status = ctx.url.searchParams.get("status");
  const rows = status
    ? await all(ctx.env, "SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC LIMIT 100", status)
    : await all(ctx.env, "SELECT * FROM outbox ORDER BY created_at DESC LIMIT 100");
  return json({ messages: rows });
}

const notifications: Module = {
  name: "notifications",
  register(r) {
    r.get("/api/notifications/outbox", list);
  },
  // Sending is connected in a later stage (email/WhatsApp provider); messages wait in the outbox.
};
export default notifications;
