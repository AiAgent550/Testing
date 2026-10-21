// Bindings, variables and secrets available to every module.
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;

  APP_ORIGIN: string;
  SITE_ORIGIN: string;
  BUSINESS_NAME: string;

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

export interface User {
  id: string;
  email: string;
  name: string;
  totp_enabled: number;
}

export interface Session {
  id_hash: string;
  user_id: string;
  mfa_ok: number;
  expires_at: string;
}
