// Module: vehicles. Registration lookups (DVLA + DVSA) and the cars we've seen.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { all } from "../../lib/db";
import { badRequest, json, notFound } from "../../lib/http";
import { int, nullable, parse, str, vin } from "../../lib/validate";
import { getCustomer } from "../customers/service";
import { getVehicle, lookupVehicle, publicVehicle, refreshVehicle, updateVehicle } from "./service";

async function lookup(ctx: Ctx) {
  return json({ lookup: await lookupVehicle(ctx.env, ctx.params.reg) });
}

async function detail(ctx: Ctx) {
  const v = await getVehicle(ctx.env, ctx.params.id);
  if (!v) throw notFound("Vehicle");
  const [owner, bookings, jobs] = await Promise.all([
    v.customer_id ? getCustomer(ctx.env, v.customer_id) : Promise.resolve(null),
    all(ctx.env, `SELECT b.id, b.ref, b.service, b.status, b.preferred_date, b.scheduled_start, b.created_at, c.name AS customer_name
                    FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
                   WHERE b.vehicle_id = ? ORDER BY b.created_at DESC LIMIT 100`, v.id),
    all(ctx.env, "SELECT id, ref, title, status, mileage, created_at, completed_at FROM jobs WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 100", v.id),
  ]);
  return json({ vehicle: publicVehicle(v), customer: owner, bookings, jobs });
}

async function patch(ctx: Ctx) {
  const input = parse(await ctx.body(), {
    vin: nullable(vin()),
    last_mileage: nullable(int({ min: 0, max: 2_000_000 })),
    customer_id: nullable(str({ max: 64 })),
  });
  if (input.customer_id && !(await getCustomer(ctx.env, input.customer_id))) throw badRequest("That customer wasn't found.", { customer_id: "Not found." });
  const v = await updateVehicle(ctx.env, ctx.params.id, input, userOf(ctx).id);
  return json({ vehicle: publicVehicle(v) });
}

async function refresh(ctx: Ctx) {
  const { vehicle, lookup } = await refreshVehicle(ctx.env, ctx.params.id, userOf(ctx).id);
  return json({ vehicle: publicVehicle(vehicle), lookup });
}

const vehicles: Module = {
  name: "vehicles",
  register(r) {
    r.get("/api/vehicles/lookup/:reg", lookup);
    r.get("/api/vehicles/:id", detail);
    r.patch("/api/vehicles/:id", patch);
    r.post("/api/vehicles/:id/refresh", refresh);
  },
};
export default vehicles;
