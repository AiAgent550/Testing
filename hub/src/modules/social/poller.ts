// The comment watcher: reads new public comments from every active account, stores them once
// (deduplicated on platform + external id), then hands untriaged ones to lead triage.
import type { Env } from "../../lib/env";
import { all, newId, now, run } from "../../lib/db";
import { triagePending } from "../leads/triage";
import { getAdapter } from "./adapters";
import { markNeedsReauth } from "./accounts";
import { AdapterError, type IncomingComment, type SocialAccountRow } from "./types";

export const FIRST_POLL_DAYS = 7;
/** Re-read a little before the last poll, in case a platform shows a comment late; duplicates are ignored. */
const OVERLAP_MS = 5 * 60_000;

export interface PollResult {
  accounts: number;
  newComments: number;
  newLeads: number;
  triaged: number;
  errors: { account_id: string; handle: string; code: string; message: string }[];
}

export async function storeComments(env: Env, account: SocialAccountRow, items: IncomingComment[]): Promise<number> {
  let added = 0;
  const fetched = now();
  for (const c of items) {
    if (c.fromSelf || !c.body.trim()) continue;
    const res = await run(
      env,
      `INSERT OR IGNORE INTO comments (id, account_id, platform, external_id, external_post_id, parent_external_id, author_name, author_handle, body, posted_at, fetched_at, triaged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      newId("cmt"), account.id, account.platform, c.externalId, c.externalPostId, c.parentExternalId,
      c.authorName?.slice(0, 120) ?? null, c.authorHandle?.slice(0, 120) ?? null, c.body.slice(0, 5000), c.postedAt, fetched,
    );
    added += res.meta.changes ?? 0;
  }
  return added;
}

export async function pollAccount(env: Env, account: SocialAccountRow): Promise<number> {
  const startedAt = Date.now();
  const since = account.last_polled_at
    ? new Date(Date.parse(account.last_polled_at) - OVERLAP_MS).toISOString()
    : new Date(startedAt - FIRST_POLL_DAYS * 864e5).toISOString();
  const items = await getAdapter(env, account).listNewComments(account, since);
  const added = await storeComments(env, account, items);
  await run(env, "UPDATE social_accounts SET last_polled_at = ? WHERE id = ?", new Date(startedAt).toISOString(), account.id);
  return added;
}

export async function pollAll(env: Env): Promise<PollResult> {
  const accounts = await all<SocialAccountRow>(env, "SELECT * FROM social_accounts WHERE status = 'active' AND platform != 'tiktok' ORDER BY created_at");
  const result: PollResult = { accounts: accounts.length, newComments: 0, newLeads: 0, triaged: 0, errors: [] };
  for (const account of accounts) {
    try {
      result.newComments += await pollAccount(env, account);
    } catch (err) {
      const e = err instanceof AdapterError ? err : new AdapterError("platform", (err as Error)?.message || "Unknown error");
      if (e.code === "needs_reauth") await markNeedsReauth(env, account, e.message);
      if (!(err instanceof AdapterError)) console.error("poll", account.id, err);
      result.errors.push({ account_id: account.id, handle: account.handle, code: e.code, message: e.message });
    }
  }
  const t = await triagePending(env);
  result.newLeads = t.newLeads;
  result.triaged = t.triaged;
  return result;
}
