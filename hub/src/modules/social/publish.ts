// Publishing a post to its target accounts. Each target is published on its own; temporary
// failures stay queued and the scheduled run retries them (for up to a day).
import type { Env } from "../../lib/env";
import { audit } from "../../lib/audit";
import { all, first, now, run } from "../../lib/db";
import { getAdapter } from "./adapters";
import { getAccount, markNeedsReauth } from "./accounts";
import { signMediaToken } from "./mediatoken";
import { AdapterError, type PostTargetRow, type SocialPostRow } from "./types";

const RETRY_FOR_MS = 24 * 3600_000;

export async function mediaUrlFor(env: Env, postId: string): Promise<string> {
  return `${env.APP_ORIGIN}/api/public/media/${await signMediaToken(env.ENCRYPTION_KEY, postId)}`;
}

async function setTarget(env: Env, id: string, status: PostTargetRow["status"], fields: { external_post_id?: string | null; error?: string | null; published_at?: string | null }) {
  await run(env, "UPDATE social_post_targets SET status = ?, external_post_id = ?, error = ?, published_at = ? WHERE id = ?",
    status, fields.external_post_id ?? null, fields.error?.slice(0, 500) ?? null, fields.published_at ?? null, id);
}

/** Overall post status from its targets. */
export function rollUp(statuses: PostTargetRow["status"][]): SocialPostRow["status"] {
  if (!statuses.length) return "draft";
  const n = (s: string) => statuses.filter(x => x === s).length;
  if (n("published") === statuses.length) return "published";
  if (n("queued") || n("publishing")) return "queued";
  if (n("published")) return "partial";
  return "failed";
}

/** Publishes every queued target of the post; returns the post's new status. */
export async function publishPost(env: Env, postId: string, actorId: string | null): Promise<SocialPostRow["status"]> {
  const post = await first<SocialPostRow>(env, "SELECT * FROM social_posts WHERE id = ?", postId);
  if (!post) throw new Error("post not found");
  const targets = await all<PostTargetRow>(env, "SELECT * FROM social_post_targets WHERE post_id = ? AND status = 'queued'", postId);
  await run(env, "UPDATE social_posts SET status = 'publishing', updated_at = ? WHERE id = ?", now(), postId);
  const giveUp = Date.parse(post.created_at) < Date.now() - RETRY_FOR_MS;
  const mediaUrl = await mediaUrlFor(env, postId);

  for (const t of targets) {
    // Claim the target so an overlapping run can't publish it twice.
    const claimed = await run(env, "UPDATE social_post_targets SET status = 'publishing' WHERE id = ? AND status = 'queued'", t.id);
    if (!claimed.meta.changes) continue;
    const account = await getAccount(env, t.account_id);
    try {
      if (!account || account.status === "disabled") throw new AdapterError("not_supported", "This account has been disconnected.");
      if (account.status === "needs_reauth") throw new AdapterError("needs_reauth", "This account needs connecting again.");
      const adapter = getAdapter(env, account);
      if (!adapter.publish) throw new AdapterError("not_supported", `Publishing to ${account.platform} isn't supported yet.`);
      const resume = t.external_post_id?.startsWith("container:") ? t.external_post_id : undefined;
      const { externalPostId } = await adapter.publish(account, post, mediaUrl, resume);
      await setTarget(env, t.id, "published", { external_post_id: externalPostId, published_at: now() });
      await audit(env, actorId, "social.post_published", "social_post", postId, { target: t.id, platform: account.platform, external_post_id: externalPostId });
    } catch (err) {
      const e = err instanceof AdapterError ? err : new AdapterError("platform", (err as Error)?.message || "Unknown error");
      if (!(err instanceof AdapterError)) console.error("publish", t.id, err);
      if (e.code === "needs_reauth" && account) await markNeedsReauth(env, account, e.message);
      const retry = e.transient && !giveUp;
      await setTarget(env, t.id, retry ? "queued" : "failed", { error: e.message, external_post_id: e.resume ?? (retry ? t.external_post_id : null) });
      if (!retry) await audit(env, actorId, "social.post_failed", "social_post", postId, { target: t.id, error: e.message.slice(0, 200) });
    }
  }
  const statuses = (await all<{ status: PostTargetRow["status"] }>(env, "SELECT status FROM social_post_targets WHERE post_id = ?", postId)).map(r => r.status);
  const status = rollUp(statuses);
  await run(env, "UPDATE social_posts SET status = ?, updated_at = ? WHERE id = ?", status, now(), postId);
  return status;
}

/** Scheduled: retry posts that still have queued targets. */
export async function retryQueuedPosts(env: Env): Promise<void> {
  const posts = await all<{ id: string }>(env,
    `SELECT DISTINCT p.id FROM social_posts p JOIN social_post_targets t ON t.post_id = p.id
      WHERE p.status IN ('queued','publishing') AND t.status = 'queued' ORDER BY p.created_at LIMIT 10`);
  for (const p of posts) {
    try { await publishPost(env, p.id, null); } catch (err) { console.error("retry publish", p.id, err); }
  }
}
