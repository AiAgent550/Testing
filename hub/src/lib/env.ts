// Bindings, variables and secrets available to every module.
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;

  APP_ORIGIN: string;
  SITE_ORIGIN: string;
  BUSINESS_NAME: string;

  /** Cloudflare Email Routing send_email binding; delivers only to STAFF_ALERT_TO (a verified address). */
  STAFF_MAIL?: SendEmail;
  STAFF_ALERT_TO?: string;

  /** Web Push (phone notifications): VAPID key pair, base64url raw keys. Generate with scripts/vapid-keys.mjs. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;

  /** Cloudflare Email Service binding (no destination restriction): customer emails from MAIL_FROM. */
  EMAIL?: { send(message: OutboundEmail): Promise<{ messageId: string }> };
  MAIL_FROM?: string;
  MAIL_BCC?: string;

  /** Printed on invoices; kept as secrets, not in the repository. */
  BANK_ACCOUNT_NAME?: string;
  BANK_SORT_CODE?: string;
  BANK_ACCOUNT_NUMBER?: string;

  ENCRYPTION_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DVLA_API_KEY?: string;
  DVSA_CLIENT_ID?: string;
  DVSA_CLIENT_SECRET?: string;
  DVSA_API_KEY?: string;
  DVSA_TOKEN_URL?: string;
  DVSA_SCOPE?: string;
  META_APP_SECRET?: string;
  META_APP_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
}

export interface OutboundEmail {
  from: string | { email: string; name?: string };
  to: string | string[];
  bcc?: string | string[];
  replyTo?: string | { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
  attachments?: { content: string | ArrayBuffer | ArrayBufferView; filename: string; type: string; disposition: "attachment" | "inline" }[];
}

export type Lang = "en" | "pl";
export const LANGS: readonly Lang[] = ["en", "pl"];

export interface User {
  id: string;
  email: string;
  name: string;
  totp_enabled: number;
  /** Dashboard and AI answer language. */
  lang: Lang;
}

export interface Session {
  id_hash: string;
  user_id: string;
  mfa_ok: number;
  expires_at: string;
}
