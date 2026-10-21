// Picks the adapter for an account. Every platform call in the Hub goes through here.
import type { Env } from "../../../lib/env";
import { isLocal } from "../../../lib/session";
import { AdapterError, type SocialAccountRow, type SocialAdapter } from "../types";
import { metaAdapter } from "./meta";
import { MOCK_PREFIX, mockAdapter } from "./mock";
import { tiktokAdapter } from "./tiktok";
import { youtubeAdapter } from "./youtube";

export function getAdapter(env: Env, account: SocialAccountRow): SocialAdapter {
  if (account.external_id.startsWith(MOCK_PREFIX)) {
    if (isLocal(env)) return mockAdapter();
    throw new AdapterError("not_supported", "Demo accounts only work on a local copy of the Hub.");
  }
  switch (account.platform) {
    case "instagram":
    case "facebook":
      return metaAdapter(env);
    case "youtube":
      return youtubeAdapter(env);
    case "tiktok":
      return tiktokAdapter(env);
    default:
      throw new AdapterError("not_supported", `${account.platform} accounts aren't supported.`);
  }
}
