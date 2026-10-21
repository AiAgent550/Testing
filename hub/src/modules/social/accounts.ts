// Connected social accounts: storing and reading their (encrypted) tokens and tracking their health.
import type { Env } from "../../lib/env";
import type { Platform } from "../../lib/types";
import { audit } from "../../lib/audit";
import { decrypt, encrypt } from "../../lib/crypto";
import { first, newId, now, run } from "../../lib/db";
import { AdapterError, type SocialAccountRow, type StoredToken } from "./types";

export async function getAccount(env: Env, id: string): Promise<SocialAccountRow | null> {
  return first<SocialAccountRow>(env, "SELECT * FROM social_accounts WHERE id = ?", id);
}

/** The account's decrypted token. Throws needs_reauth when there is none or it can't be read. */
export async function readToken(env: Env, account: SocialAccountRow): Promise<StoredToken> {
  if (!account.token_enc) throw new AdapterError("needs_reauth", "This account has no saved sign-in. Connect it again.");
  try {
    const raw = await decrypt(account.token_enc, env.ENCRYPTION_KEY);
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.access_token && !parsed.refresh_token) throw new Error("empty token");
    return parsed;
  } catch {
    throw new AdapterError("needs_reauth", "The saved sign-in for this account couldn't be read. Connect it again.");
  }
}

export async function writeToken(env: Env, accountId: string, token: StoredToken, expiresAt: string | null = null): Promise<void> {
  await run(env, "UPDATE social_accounts SET token_enc = ?, token_expires_at = ?, updated_at = ? WHERE id = ?",
    await encrypt(JSON.stringify(token), env.ENCRYPTION_KEY), expiresAt, now(), accountId);
}

export async function markNeedsReauth(env: Env, account: SocialAccountRow, reason: string): Promise<void> {
  if (account.status === "needs_reauth") return;
  await run(env, "UPDATE social_accounts SET status = 'needs_reauth', updated_at = ? WHERE id = ?", now(), account.id);
  account.status = "needs_reauth";
  await audit(env, null, "social.account_needs_reauth", "social_account", account.id, { reason: reason.slice(0, 300) });
}

/** Insert or refresh an account by (platform, external_id); re-activates it and replaces the token. */
export async function upsertAccount(
  env: Env, actorId: string | null,
  a: { platform: Platform; handle: string; externalId: string; token: StoredToken | null; tokenExpiresAt?: string | null },
): Promise<SocialAccountRow> {
  const t = now();
  const tokenEnc = a.token ? await encrypt(JSON.stringify(a.token), env.ENCRYPTION_KEY) : null;
  await run(
    env,
    `INSERT INTO social_accounts (id, platform, handle, external_id, token_enc, token_expires_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(platform, external_id) DO UPDATE SET handle = excluded.handle, token_enc = excluded.token_enc,
       token_expires_at = excluded.token_expires_at, status = 'active', updated_at = excluded.updated_at`,
    newId("soc"), a.platform, a.handle.slice(0, 120), a.externalId, tokenEnc, a.tokenExpiresAt ?? null, t, t,
  );
  const row = (await first<SocialAccountRow>(env, "SELECT * FROM social_accounts WHERE platform = ? AND external_id = ?", a.platform, a.externalId))!;
  await audit(env, actorId, "social.account_connect", "social_account", row.id, { platform: a.platform, handle: row.handle });
  return row;
}

/** Shape sent to the dashboard: never includes the token. */
export function publicAccount(a: SocialAccountRow) {
  return {
    id: a.id, platform: a.platform, handle: a.handle, status: a.status, last_polled_at: a.last_polled_at,
    created_at: a.created_at, connected: !!a.token_enc, demo: a.external_id.startsWith("mock_"),
  };
}
