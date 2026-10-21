// Module: customers. Search, customer records with their cars and booking history.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import type { CustomerRow } from "../../lib/types";
import { SOURCES } from "../../lib/types";
import { userOf } from "../../lib/router";
import { audit } from "../../lib/audit";
import { all, now, run, updateSet } from "../../lib/db";
import { json, notFound } from "../../lib/http";
import { email, nullable, oneOf, optional, parse, str, ukPhone, normaliseReg } from "../../lib/validate";
import { getCustomer, matchOrCreateCustomer } from "./service";
import { likeEscape, phoneSearchDigits } from "./match";

async function search(ctx: Ctx) {
  const q = (ctx.url.searchParams.get("q") || "").trim().slice(0, 80);
  const select = `SELECT c.*, (SELECT group_concat(v.reg, ',') FROM vehicles v WHERE v.customer_id = c.id) AS regs,
                         (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS booking_count
                    FROM customers c`;
  if (!q) return json({ customers: await all(ctx.env, `${select} ORDER BY c.updated_at DESC LIMIT 50`) });

  const like = `%${likeEscape(q)}%`;
  const regQ = normaliseReg(q);
  const digits = phoneSearchDigits(q);
  const rows = await all(
    ctx.env,
    `${select}
      WHERE c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'
         OR (? IS NOT NULL AND c.phone LIKE ? ESCAPE '\\')
         OR (? != '' AND EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND v.reg LIKE ? ESCAPE '\\'))
      ORDER BY c.updated_at DESC LIMIT 50`,
    like, like, digits, `%${digits ?? ""}%`, regQ, `%${likeEscape(regQ)}%`,
  );
  return json({ customers: rows });
}

async function detail(ctx: Ctx) {
  const customer = await getCustomer(ctx.env, ctx.params.id);
  if (!customer) throw notFound("Customer");
  const [vehicles, bookings] = await Promise.all([
    all(ctx.env, `SELECT id, reg, vin, make, model, colour, fuel_type, year, engine_cc, mot_status, mot_expiry, tax_status, tax_due, last_mileage, looked_up_at
                    FROM vehicles WHERE customer_id = ? ORDER BY updated_at DESC`, customer.id),
    all(ctx.env, `SELECT b.id, b.ref, b.service, b.status, b.preferred_date, b.scheduled_start, b.created_at, b.location, v.reg, v.make, v.model
                    FROM bookings b LEFT JOIN vehicles v ON v.id = b.vehicle_id
                   WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 100`, customer.id),
  ]);
  return json({ customer, vehicles, bookings });
}

const editable = {
  name: optional(str({ max: 120 })),
  phone: nullable(ukPhone()),
  email: nullable(email()),
  notes: nullable(str({ max: 2000 })),
  source: optional(oneOf(SOURCES)),
};

async function create(ctx: Ctx) {
  const input = parse(await ctx.body(), { ...editable, name: str({ max: 120 }) });
  const { customer, created } = await matchOrCreateCustomer(ctx.env, {
    name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null, source: input.source ?? "phone",
  }, userOf(ctx).id);
  return json({ customer, matched: !created }, created ? 201 : 200);
}

async function update(ctx: Ctx) {
  const existing = await getCustomer(ctx.env, ctx.params.id);
  if (!existing) throw notFound("Customer");
  const patch = parse(await ctx.body(), editable);
  const set = updateSet(patch, ["name", "phone", "email", "notes", "source"]);
  if (set.sql) {
    await run(ctx.env, `UPDATE customers SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, now(), existing.id);
    await audit(ctx.env, userOf(ctx).id, "customer.update", "customer", existing.id, { fields: Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined) });
  }
  return json({ customer: (await getCustomer(ctx.env, existing.id)) as CustomerRow });
}

const customers: Module = {
  name: "customers",
  register(r) {
    r.get("/api/customers", search);
    r.post("/api/customers", create);
    r.get("/api/customers/:id", detail);
    r.patch("/api/customers/:id", update);
  },
};
export default customers;
