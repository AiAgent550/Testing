// Every change to customer or business data is recorded: who, what, when.
import type { Env } from "./env";
import { now, run } from "./db";

export async function audit(
  env: Env,
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await run(
    env,
    "INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
    now(), userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null,
  );
}
