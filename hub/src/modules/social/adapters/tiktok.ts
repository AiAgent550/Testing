// TikTok: skeleton only. Reading comments and posting through TikTok's APIs need app review and
// approval (Research/Display APIs don't cover replying to your own comments; Content Posting API
// needs an audited app). The adapter keeps the shared interface so it can be completed later.
import type { Env } from "../../../lib/env";
import { AdapterError, type SocialAdapter } from "../types";

export const tiktokConfigured = (env: Env) => !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);

export function tiktokStatus(env: Env): { state: "not_configured" | "not_supported"; message: string } {
  return tiktokConfigured(env)
    ? { state: "not_supported", message: "TikTok keys are set, but comment and posting access needs TikTok's approval before the Hub can use it." }
    : { state: "not_configured", message: "TikTok isn't connected yet: it needs an approved TikTok developer app." };
}

export function tiktokAdapter(env: Env): SocialAdapter {
  const fail = (): never => {
    const s = tiktokStatus(env);
    throw new AdapterError(s.state, s.message);
  };
  return {
    platform: "tiktok",
    async listNewComments() { return fail(); },
    async reply() { return fail(); },
    async publish() { return fail(); },
  };
}
