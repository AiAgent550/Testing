// Module: leads. Enquiries spotted in public comments: list, edit the drafted reply, reply publicly,
// dismiss, or convert into a booking.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import type { LeadRow } from "../../lib/types";
import { SERVICES } from "../../lib/types";
import { audit } from "../../lib/audit";
import { first, all, now, run } from "../../lib/db";
import { HttpError, badRequest, conflict, json, notFound } from "../../lib/http";
import { email, isoDate, oneOf, optional, parse, reg, str, ukPhone } from "../../lib/validate";
import { createBooking } from "../bookings/service";
import { getAdapter } from "../social/adapters";
import { getAccount, markNeedsReauth } from "../social/accounts";
import { AdapterError, type CommentRow } from "../social/types";
import { MAX_REPLY } from "./triage";
import { markLeadBooked } from "./service";

const STATUSES = ["new", "replied", "booked", "dismissed"] as const;

const LEAD_SELECT = `
  SELECT l.*, c.body AS comment_body, c.posted_at AS comment_posted_at, c.account_id,
         a.handle AS account_handle, a.status AS account_status
    FROM leads l
    LEFT JOIN comments c ON c.id = l.comment_id
    LEFT JOIN social_accounts a ON a.id = c.account_id`;

type LeadView = LeadRow & { comment_body: string | null; comment_posted_at: string | null; account_id: string | null; account_handle: string | null; account_status: string | null };

async function loadLead(ctx: Ctx, id: string): Promise<LeadView> {
  const row = await first<LeadView>(ctx.env, `${LEAD_SELECT} WHERE l.id = ?`, id);
  if (!row) throw notFound("Lead");
  return row;
}

async function list(ctx: Ctx) {
  const status = ctx.url.searchParams.get("status");
  if (status && !(STATUSES as readonly string[]).includes(status)) throw badRequest("Unknown status.");
  const rows = status
    ? await all<LeadView>(ctx.env, `${LEAD_SELECT} WHERE l.status = ? ORDER BY l.created_at DESC LIMIT 200`, status)
    : await all<LeadView>(ctx.env, `${LEAD_SELECT} ORDER BY l.created_at DESC LIMIT 200`);
  return json({ leads: rows });
}

async function get(ctx: Ctx) {
  return json({ lead: await loadLead(ctx, ctx.params.id) });
}

async function patch(ctx: Ctx) {
  const lead = await loadLead(ctx, ctx.params.id);
  const input = parse(await ctx.body(), {
    suggested_reply: optional(str({ max: MAX_REPLY })),
    status: optional(oneOf(["new", "dismissed"] as const)),
  });
  if (input.suggested_reply === undefined && input.status === undefined) throw badRequest("Nothing to change.");
  if (input.status && (lead.status === "replied" || lead.status === "booked")) {
    throw conflict(`This lead has already been ${lead.status}, so it can't be moved back.`);
  }
  await run(ctx.env, "UPDATE leads SET suggested_reply = COALESCE(?, suggested_reply), status = COALESCE(?, status), updated_at = ? WHERE id = ?",
    input.suggested_reply ?? null, input.status ?? null, now(), lead.id);
  const action = input.status === "dismissed" ? "lead.dismiss" : input.status === "new" ? "lead.restore" : "lead.update";
  await audit(ctx.env, userOf(ctx).id, action, "lead", lead.id, { fields: Object.keys(input).filter(k => (input as Record<string, unknown>)[k] !== undefined) });
  return json({ lead: await loadLead(ctx, lead.id) });
}

async function reply(ctx: Ctx) {
  const { env } = ctx;
  const lead = await loadLead(ctx, ctx.params.id);
  const { text } = parse(await ctx.body(), { text: str({ max: MAX_REPLY }) });
  if (lead.status === "replied" || lead.reply_external_id) throw conflict("A public reply has already been posted for this lead.");
  const comment = lead.comment_id ? await first<CommentRow>(env, "SELECT * FROM comments WHERE id = ?", lead.comment_id) : null;
  if (!comment) throw conflict("The original comment for this lead isn't stored, so there's nothing to reply to.");
  const account = await getAccount(env, comment.account_id);
  if (!account || account.status === "disabled") throw conflict("That account has been disconnected. Connect it again on the Social page to reply.");
  if (account.status === "needs_reauth") throw new HttpError(409, "needs_reauth", `@${account.handle} needs connecting again before you can reply. Go to Social and reconnect it.`);
  // Claim the lead so a double tap (or both staff at once) can't post the reply twice.
  const claimed = await run(env, "UPDATE leads SET reply_external_id = 'sending', updated_at = ? WHERE id = ? AND reply_external_id IS NULL AND status != 'replied'", now(), lead.id);
  if (!claimed.meta.changes) throw conflict("A public reply is already being posted for this lead.");
  let externalId: string;
  try {
    ({ externalId } = await getAdapter(env, account).reply(account, comment, text));
  } catch (err) {
    await run(env, "UPDATE leads SET reply_external_id = NULL WHERE id = ? AND reply_external_id = 'sending'", lead.id);
    if (err instanceof AdapterError) {
      if (err.code === "needs_reauth") {
        await markNeedsReauth(env, account, err.message);
        throw new HttpError(409, "needs_reauth", `@${account.handle} needs connecting again before you can reply. Go to Social and reconnect it.`);
      }
      throw new HttpError(502, "platform_error", `The reply wasn't posted: ${err.message}`);
    }
    throw err;
  }
  const t = now();
  await run(env, "UPDATE leads SET status = 'replied', suggested_reply = ?, reply_external_id = ?, replied_at = ?, updated_at = ? WHERE id = ?",
    text, externalId, t, t, lead.id);
  await audit(env, userOf(ctx).id, "lead.reply", "lead", lead.id, { platform: account.platform, account: account.handle, reply_external_id: externalId, text });
  return json({ lead: await loadLead(ctx, lead.id) });
}

async function book(ctx: Ctx) {
  const { env } = ctx;
  const lead = await loadLead(ctx, ctx.params.id);
  if (lead.status === "booked" || lead.booking_id) throw conflict("This lead has already been booked in.");
  const input = parse(await ctx.body(), {
    name: str({ max: 120 }),
    phone: optional(ukPhone()),
    email: optional(email()),
    reg: optional(reg()),
    service: optional(oneOf(SERVICES)),
    description: optional(str({ max: 2000 })),
    preferred_date: optional(isoDate()),
    location: optional(oneOf(["workshop", "mobile"] as const)),
  });
  let booking;
  try {
    booking = await createBooking(env, {
      customer: { name: input.name, phone: input.phone ?? null, email: input.email ?? null },
      reg: input.reg ?? null,
      service: input.service ?? lead.service ?? "other",
      description: input.description ?? lead.summary,
      preferred_date: input.preferred_date ?? null,
      location: input.location ?? "workshop",
      address: null,
      source: "social",
      lead_id: lead.id,
    }, userOf(ctx).id);
  } catch (err) {
    if (err instanceof HttpError) throw err; // validation from bookings: show it as-is
    console.error("lead book-in", lead.id, err instanceof Error ? err.message : err);
    throw new HttpError(503, "bookings_unavailable", "Bookings can't be created from here yet, so this lead wasn't booked in. Add the booking by hand for now; the lead stays open.");
  }
  await markLeadBooked(env, lead.id, booking.id);
  await audit(env, userOf(ctx).id, "lead.book", "lead", lead.id, { booking_id: booking.id, booking_ref: booking.ref });
  return json({ lead: await loadLead(ctx, lead.id), booking: { id: booking.id, ref: booking.ref } }, 201);
}

const leads: Module = {
  name: "leads",
  register(r) {
    r.get("/api/leads", list);
    r.get("/api/leads/:id", get);
    r.patch("/api/leads/:id", patch);
    r.post("/api/leads/:id/reply", reply);
    r.post("/api/leads/:id/book", book);
  },
};
export default leads;
