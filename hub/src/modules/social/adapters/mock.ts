// LOCAL DEVELOPMENT ONLY: a pretend Instagram account with fixed sample comments, so the whole
// comment -> lead -> reply -> booking flow (and publishing) can be tried without real accounts.
// getAdapter() only hands this out when isLocal(env); mock accounts can't be created in production.
import { randomToken } from "../../../lib/crypto";
import type { IncomingComment, SocialAccountRow, SocialAdapter } from "../types";

export const MOCK_PREFIX = "mock_";

/** The same comments every time (ids are stable, so a second poll finds nothing new). */
export const MOCK_COMMENTS: { n: number; handle: string; body: string; hoursAgo: number; self?: boolean; parent?: number }[] = [
  { n: 1, handle: "jay_a45", body: "how much for a stage 1 on my 2019 A45?", hoursAgo: 30 },
  { n: 2, handle: "sarah.leeds", body: "lost both keys to my C220 2016 can you help? in Leeds", hoursAgo: 20 },
  { n: 3, handle: "fastlane_ffs", body: "🔥🔥", hoursAgo: 16 },
  { n: 4, handle: "carspotter_uk", body: "nice car", hoursAgo: 12 },
  { n: 5, handle: "golfgti_dan", body: "do you do mobile key programming for VW Golf 2020?", hoursAgo: 6 },
  { n: 6, handle: "anon_4471", body: "scam", hoursAgo: 3 },
  // The business's own reply under the first comment: must be skipped by the watcher.
  { n: 7, handle: "", body: "Thanks Jay, drop us a message with your reg!", hoursAgo: 2, self: true, parent: 1 },
];

export function mockAdapter(): SocialAdapter {
  return {
    platform: "mock",
    async listNewComments(account: SocialAccountRow): Promise<IncomingComment[]> {
      const base = Date.now();
      return MOCK_COMMENTS.map(c => ({
        externalId: `${account.external_id}_c${c.n}`,
        externalPostId: `${account.external_id}_post1`,
        parentExternalId: c.parent ? `${account.external_id}_c${c.parent}` : null,
        authorName: c.self ? account.handle : c.handle,
        authorHandle: c.self ? account.handle : c.handle,
        body: c.body,
        postedAt: new Date(base - c.hoursAgo * 3600_000).toISOString(),
        fromSelf: !!c.self,
      }));
    },
    async reply() {
      return { externalId: `${MOCK_PREFIX}reply_${randomToken(6)}` };
    },
    async publish() {
      return { externalPostId: `${MOCK_PREFIX}post_${randomToken(6)}` };
    },
  };
}
