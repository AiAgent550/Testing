// Shapes shared by the social adapters, the comment watcher and the publishing queue.
import type { Platform } from "../../lib/types";

export interface SocialAccountRow {
  id: string;
  platform: Platform;
  handle: string;
  external_id: string;
  token_enc: string | null;
  token_expires_at: string | null;
  status: "active" | "needs_reauth" | "disabled";
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  account_id: string;
  platform: string;
  external_id: string;
  external_post_id: string | null;
  parent_external_id: string | null;
  author_name: string | null;
  author_handle: string | null;
  body: string;
  posted_at: string | null;
  fetched_at: string;
  triaged: number;
}

export interface SocialPostRow {
  id: string;
  caption: string;
  media_r2_key: string | null;
  media_type: string | null;
  status: "draft" | "queued" | "publishing" | "published" | "partial" | "failed";
  scheduled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostTargetRow {
  id: string;
  post_id: string;
  account_id: string;
  status: "queued" | "publishing" | "published" | "failed";
  external_post_id: string | null;
  error: string | null;
  published_at: string | null;
}

/** A public comment as read from a platform, before it is stored. */
export interface IncomingComment {
  externalId: string;
  externalPostId: string | null;
  parentExternalId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  body: string;
  postedAt: string | null;        // ISO-8601 UTC
  /** Written by the business's own account (our replies): stored nowhere, never triaged. */
  fromSelf: boolean;
}

export interface SocialAdapter {
  platform: Platform | "mock";
  listNewComments(account: SocialAccountRow, sinceIso: string): Promise<IncomingComment[]>;
  reply(account: SocialAccountRow, comment: CommentRow, text: string): Promise<{ externalId: string }>;
  /**
   * `resume` is what an earlier "pending" AdapterError handed back (e.g. an Instagram container id),
   * so a retry carries on instead of uploading again.
   */
  publish?(account: SocialAccountRow, post: SocialPostRow, mediaUrl: string, resume?: string): Promise<{ externalPostId: string }>;
}

/**
 * A platform call that failed in a way the Hub understands:
 *   needs_reauth   token expired, revoked or missing a permission: the account must be reconnected
 *   not_supported  the platform (or this account type) can't do this yet
 *   not_configured the app keys for this platform aren't set
 *   rate_limited   try again later
 *   pending        the platform is still processing (e.g. a video); try again later
 *   platform       any other error from the platform
 */
export type AdapterErrorCode = "needs_reauth" | "not_supported" | "not_configured" | "rate_limited" | "pending" | "platform";

export class AdapterError extends Error {
  constructor(public code: AdapterErrorCode, message: string, public resume?: string) {
    super(message);
  }
  /** Worth retrying later without anyone doing anything. */
  get transient(): boolean {
    return this.code === "rate_limited" || this.code === "pending" || this.code === "platform";
  }
}

/** Decrypted token blob kept in social_accounts.token_enc (JSON, AES-GCM encrypted). */
export interface StoredToken {
  access_token: string;
  /** Google only: long-lived refresh token. */
  refresh_token?: string;
  /** ISO time the access token stops working (Google access tokens: about an hour). */
  access_expires_at?: string;
}
