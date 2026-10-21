// Small helpers over D1 so modules read the same way everywhere.
import type { Env } from "./env";
import { randomBytes } from "./crypto";

export const now = () => new Date().toISOString();

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-style, no i/l/o/u

/** Prefixed, time-ordered id, e.g. bkg_01j9x3k2m4n5p6q7r8s9t0. */
export function newId(prefix: string): string {
  let t = Date.now(), time = "";
  for (let i = 0; i < 10; i++) { time = ID_ALPHABET[t % 32] + time; t = Math.floor(t / 32); }
  let rand = "";
  for (const b of randomBytes(12)) rand += ID_ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

export async function first<T>(env: Env, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(env: Env, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...params).all<T>()).results ?? [];
}

export async function run(env: Env, sql: string, ...params: unknown[]): Promise<D1Result> {
  return env.DB.prepare(sql).bind(...params).run();
}

/** Next human reference from a named counter, e.g. nextRef(env, "booking_ref", "MK") -> "MK-1001". */
export async function nextRef(env: Env, counter: string, prefix: string): Promise<string> {
  const row = await first<{ value: number }>(env, "UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value", counter);
  if (!row) throw new Error(`Unknown counter ${counter}`);
  return `${prefix}-${row.value}`;
}

/** Build "SET a = ?, b = ?" from a patch object, limited to allowed columns. */
export function updateSet(patch: Record<string, unknown>, allowed: readonly string[]): { sql: string; params: unknown[] } {
  const cols = Object.keys(patch).filter(k => allowed.includes(k) && patch[k] !== undefined);
  return { sql: cols.map(c => `${c} = ?`).join(", "), params: cols.map(c => patch[c]) };
}
