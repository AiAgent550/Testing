// Contract other modules use. Implemented in stage 2.
import type { Env } from "../../lib/env";
import type { CustomerRow, Source } from "../../lib/types";

export interface CustomerInput { name: string; phone?: string | null; email?: string | null; source: Source; notes?: string | null }

/** Matches an existing customer by phone, then email; otherwise creates one. */
export async function findOrCreateCustomer(_env: Env, _input: CustomerInput, _actorId: string | null): Promise<CustomerRow> {
  throw new Error("customers.findOrCreateCustomer not implemented yet");
}
