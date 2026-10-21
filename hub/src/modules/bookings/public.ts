// Endpoints the public website calls: the booking form and the registration autofill.
// Only the website's own origin (env.SITE_ORIGIN) may call them (CORS + an explicit Origin check),
// they are rate limited per IP, and the form carries a honeypot field for bots.
import type { Ctx, Handler } from "../../lib/router";
import { SERVICES } from "../../lib/types";
import { HttpError, badRequest, clientIp, errorResponse, forbidden, json } from "../../lib/http";
import { guard, record } from "../../lib/ratelimit";
import { email, isoDate, oneOf, optional, parse, reg, str, ukPhone } from "../../lib/validate";
import { lookupVehicle } from "../vehicles/service";
import { createBooking } from "./service";
import { ukToday } from "./status";

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** Wraps a public handler: rejects other origins, and adds CORS headers to every answer (errors included, so the form can show them). */
export function sitePublic(handler: Handler): Handler {
  return async (ctx: Ctx) => {
    const origin = ctx.req.headers.get("origin");
    if (origin !== ctx.env.SITE_ORIGIN) {
      const res = errorResponse(forbidden("Requests are only accepted from the M&K website."));
      res.headers.set("vary", "Origin");
      return res;
    }
    let res: Response;
    try { res = await handler(ctx); }
    catch (err) {
      if (err instanceof HttpError) res = errorResponse(err);
      else {
        const ref = crypto.randomUUID().slice(0, 8);
        console.error(`[${ref}]`, ctx.req.method, ctx.url.pathname, err);
        res = json({ error: { code: "server_error", message: `Something went wrong (ref ${ref}). Please call us instead.` } }, 500);
      }
    }
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
    return res;
  };
}

export const preflight: Handler = sitePublic(() => new Response(null, { status: 204 }));

/** A believable reference for bots that filled the honeypot. Nothing is stored. */
const fakeRef = () => `MK-${1000 + Math.floor(Math.random() * 9000)}`;

export const publicBooking: Handler = sitePublic(async ctx => {
  const { env } = ctx;
  const ip = clientIp(ctx.req);
  await guard(env, "public_booking", ip, 5, 60, true);
  const body = await ctx.body();
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const hp = (body as Record<string, unknown>).website;
    if (typeof hp === "string" ? hp.trim() !== "" : hp !== undefined && hp !== null) return json({ ref: fakeRef() });
  }
  const input = parse(body, {
    name: str({ max: 120 }),
    phone: ukPhone(),
    email: optional(email()),
    reg: optional(reg()),
    service: oneOf(SERVICES),
    description: optional(str({ max: 1000 })),
    preferred_date: optional(isoDate()),
    location: optional(oneOf(["workshop", "mobile"] as const)),
    address: optional(str({ max: 300 })),
  });
  const location = input.location ?? "workshop";
  const fields: Record<string, string> = {};
  if (location === "mobile" && !input.address) fields.address = "Tell us where the car is for a mobile visit.";
  if (input.preferred_date) {
    const today = ukToday();
    if (input.preferred_date < today) fields.preferred_date = "Choose today or a later date.";
    else if (input.preferred_date > ukToday(new Date(Date.now() + 366 * 864e5))) fields.preferred_date = "Choose a date within the next year.";
  }
  if (Object.keys(fields).length) throw badRequest("Some fields need fixing.", fields);

  await record(env, "public_booking", ip, true);
  const booking = await createBooking(env, {
    customer: { name: input.name, phone: input.phone, email: input.email ?? null },
    reg: input.reg ?? null,
    service: input.service,
    description: input.description ?? null,
    preferred_date: input.preferred_date ?? null,
    location,
    address: input.address ?? null,
    source: "website",
  }, null);
  return json({ ref: booking.ref });
});

export const publicVehicle: Handler = sitePublic(async ctx => {
  const { env } = ctx;
  const ip = clientIp(ctx.req);
  await guard(env, "public_vehicle", ip, 20, 60, true);
  const { reg: r } = parse({ reg: ctx.params.reg }, { reg: reg() });
  await record(env, "public_vehicle", ip, true);
  const l = await lookupVehicle(env, r);
  return json({ found: l.found, make: l.make, model: l.model, colour: l.colour, year: l.year });
});
