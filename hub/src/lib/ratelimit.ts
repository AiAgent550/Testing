// Attempt counting for sign-in, two-step codes and the public booking form.
import type { Env } from "./env";
import { first, now, run } from "./db";
import { tooMany } from "./http";

/** Throws 429 when `key` has `max` failed (or, with countAll, any) attempts of `kind` inside the window. */
export async function guard(env: Env, kind: string, key: string, max: number, windowMinutes: number, countAll = false): Promise<void> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const row = await first<{ n: number }>(
    env,
    `SELECT COUNT(*) AS n FROM auth_attempts WHERE kind = ? AND key = ? AND at > ?${countAll ? "" : " AND ok = 0"}`,
    kind, key, since,
  );
  if ((row?.n ?? 0) >= max) throw tooMany();
}

export async function record(env: Env, kind: string, key: string, ok: boolean): Promise<void> {
  await run(env, "INSERT INTO auth_attempts (kind, key, ok, at) VALUES (?, ?, ?, ?)", kind, key, ok ? 1 : 0, now());
}

/** Old attempts are only useful for a short window; trimmed by the scheduled job. */
export async function prune(env: Env): Promise<void> {
  await run(env, "DELETE FROM auth_attempts WHERE at < ?", new Date(Date.now() - 2 * 864e5).toISOString());
}
