// Contract other modules use: recognising returning customers and reading customer records.
import type { Env } from "../../lib/env";
import type { CustomerRow, Source } from "../../lib/types";
import { audit } from "../../lib/audit";
import { first, newId, now, run, updateSet } from "../../lib/db";
import { badRequest } from "../../lib/http";
import { blankFieldPatch, normaliseEmail, normalisePhone } from "./match";

export interface CustomerInput { name: string; phone?: string | null; email?: string | null; source: Source; notes?: string | null }

/** Matches an existing customer by phone, then email; otherwise creates one. Blank fields on a match are filled in. */
export async function findOrCreateCustomer(env: Env, input: CustomerInput, actorId: string | null): Promise<CustomerRow> {
  return (await matchOrCreateCustomer(env, input, actorId)).customer;
}

/** As findOrCreateCustomer, also saying whether a new record was made. */
export async function matchOrCreateCustomer(env: Env, input: CustomerInput, actorId: string | null): Promise<{ customer: CustomerRow; created: boolean }> {
  const name = (input.name || "").trim().slice(0, 120);
  if (!name) throw badRequest("Some fields need fixing.", { name: "Required." });
  const phone = normalisePhone(input.phone);
  const email = normaliseEmail(input.email);
  const notes = input.notes?.trim() || null;

  let match: CustomerRow | null = null;
  if (phone) match = await first<CustomerRow>(env, "SELECT * FROM customers WHERE phone = ? ORDER BY created_at LIMIT 1", phone);
  if (!match && email) match = await first<CustomerRow>(env, "SELECT * FROM customers WHERE email = ? ORDER BY created_at LIMIT 1", email);

  if (match) {
    const patch = blankFieldPatch(match, { phone, email, notes });
    const set = updateSet(patch, ["phone", "email", "notes"]);
    if (set.sql) {
      await run(env, `UPDATE customers SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, now(), match.id);
      await audit(env, actorId, "customer.update", "customer", match.id, { filled: Object.keys(patch), via: "match" });
      return { customer: (await getCustomer(env, match.id))!, created: false };
    }
    return { customer: match, created: false };
  }

  const id = newId("cus"), t = now();
  await run(
    env,
    "INSERT INTO customers (id, name, phone, email, notes, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, name, phone, email, notes, input.source, t, t,
  );
  await audit(env, actorId, "customer.create", "customer", id, { source: input.source });
  return { customer: (await getCustomer(env, id))!, created: true };
}

export async function getCustomer(env: Env, id: string): Promise<CustomerRow | null> {
  return first<CustomerRow>(env, "SELECT * FROM customers WHERE id = ?", id);
}
