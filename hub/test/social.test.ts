import { describe, expect, it } from "vitest";
import { randomBytes, toB64 } from "../src/lib/crypto";
import type { Env } from "../src/lib/env";
import { b64url, fromB64url, signMediaToken, verifyMediaToken } from "../src/modules/social/mediatoken";
import { GRAPH_VERSION, graphError, isoFrom, parseFbComments, parseIgComments } from "../src/modules/social/adapters/meta";
import { googleError, parseYtThreads } from "../src/modules/social/adapters/youtube";
import { tiktokAdapter } from "../src/modules/social/adapters/tiktok";
import { MOCK_COMMENTS, mockAdapter } from "../src/modules/social/adapters/mock";
import { getAdapter } from "../src/modules/social/adapters";
import { googleAuthUrl, metaAuthUrl, META_SCOPES } from "../src/modules/social/oauth";
import { rollUp } from "../src/modules/social/publish";
import { AdapterError, type SocialAccountRow } from "../src/modules/social/types";

const account = (o: Partial<SocialAccountRow> = {}): SocialAccountRow => ({
  id: "soc_1", platform: "instagram", handle: "mkautoservices", external_id: "17841400000000001", token_enc: null, token_expires_at: null,
  status: "active", last_polled_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", ...o,
});

describe("media tokens", () => {
  const key = toB64(randomBytes(32));
  const t0 = Date.UTC(2026, 9, 21, 12, 0, 0);

  it("round-trips the post id", async () => {
    const tok = await signMediaToken(key, "post_abc123", t0);
    expect(tok).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyMediaToken(key, tok, t0 + 1000)).toBe("post_abc123");
  });
  it("expires after an hour", async () => {
    const tok = await signMediaToken(key, "post_abc123", t0);
    expect(await verifyMediaToken(key, tok, t0 + 3599_000)).toBe("post_abc123");
    expect(await verifyMediaToken(key, tok, t0 + 3601_000)).toBeNull();
  });
  it("rejects tampering", async () => {
    const tok = await signMediaToken(key, "post_abc123", t0);
    const [payload, sig] = tok.split(".");
    const forged = b64url(`post_other.${Math.floor(t0 / 1000) + 999999}`);
    expect(await verifyMediaToken(key, `${forged}.${sig}`, t0)).toBeNull();
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(await verifyMediaToken(key, `${payload}.${flipped}`, t0)).toBeNull();
    expect(await verifyMediaToken(key, `${payload}`, t0)).toBeNull();
    expect(await verifyMediaToken(key, "not a token", t0)).toBeNull();
    expect(await verifyMediaToken(key, "", t0)).toBeNull();
  });
  it("rejects a token signed with another key", async () => {
    const tok = await signMediaToken(toB64(randomBytes(32)), "post_abc123", t0);
    expect(await verifyMediaToken(key, tok, t0)).toBeNull();
    expect(await verifyMediaToken(undefined, tok, t0)).toBeNull();
  });
  it("base64url helpers round-trip", () => {
    expect(fromB64url(b64url("post_x.1790000000"))).toBe("post_x.1790000000");
  });
});

describe("Meta response parsing", () => {
  const igFixture = {
    data: [
      {
        id: "17900000000000001", text: "how much for a stage 1 on my A45?", username: "jay_a45", timestamp: "2026-10-20T09:15:02+0000",
        replies: { data: [
          { id: "17900000000000002", text: "Hi Jay, send us your reg!", username: "mkautoservices", timestamp: "2026-10-20T10:00:00+0000" },
          { id: "17900000000000003", text: "same for my C63 please", username: "other_guy", timestamp: "2026-10-20T11:00:00+0000" },
        ] },
      },
      { id: "17900000000000004", text: "", username: "blank", timestamp: "2026-10-20T09:00:00+0000" },
    ],
  };
  it("reads Instagram comments, replies and our own replies", () => {
    const out = parseIgComments(igFixture, "media_1", account());
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ externalId: "17900000000000001", externalPostId: "media_1", parentExternalId: null, authorHandle: "jay_a45", postedAt: "2026-10-20T09:15:02.000Z", fromSelf: false });
    expect(out[1]).toMatchObject({ parentExternalId: "17900000000000001", fromSelf: true });
    expect(out[2]).toMatchObject({ authorHandle: "other_guy", fromSelf: false });
  });

  const fbFixture = {
    data: [
      { id: "111_222", message: "Do you do spare keys for a 2016 Corsa?", from: { id: "999", name: "Sarah Jones" }, created_time: "2026-10-19T08:00:00+0000" },
      { id: "111_223", message: "Yes we do! Send us your reg.", from: { id: "123456", name: "M&K Auto Services" }, created_time: "2026-10-19T09:00:00+0000", parent: { id: "111_222" } },
      { id: "111_224", from: { id: "998", name: "Sticker Person" }, created_time: "2026-10-19T09:30:00+0000" },
    ],
    paging: { cursors: { before: "x", after: "y" } },
  };
  it("reads Facebook Page comments and skips the Page's own replies and stickers", () => {
    const out = parseFbComments(fbFixture, "123456_777", account({ platform: "facebook", external_id: "123456", handle: "M&K Auto Services" }));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ externalId: "111_222", authorName: "Sarah Jones", fromSelf: false, postedAt: "2026-10-19T08:00:00.000Z" });
    expect(out[1]).toMatchObject({ parentExternalId: "111_222", fromSelf: true });
  });

  it("classifies Graph errors", () => {
    expect(graphError(400, { error: { code: 190, message: "Error validating access token" } }).code).toBe("needs_reauth");
    expect(graphError(403, { error: { code: 200, message: "Permissions error" } }).code).toBe("needs_reauth");
    expect(graphError(400, { error: { code: 4, message: "Application request limit reached" } }).code).toBe("rate_limited");
    expect(graphError(500, { error: { code: 1, message: "An unknown error occurred" } }).code).toBe("platform");
  });
  it("normalises Graph timestamps and pins one API version", () => {
    expect(isoFrom("2026-10-20T09:15:02+0000")).toBe("2026-10-20T09:15:02.000Z");
    expect(isoFrom("nonsense")).toBeNull();
    expect(GRAPH_VERSION).toMatch(/^v\d+\.0$/);
  });
});

describe("YouTube response parsing", () => {
  const ytFixture = {
    kind: "youtube#commentThreadListResponse",
    items: [
      {
        id: "UgzThread1",
        snippet: {
          videoId: "vid123",
          topLevelComment: { id: "UgzThread1", snippet: { textDisplay: "Can you code my W205?", textOriginal: "Can you code my W205?", authorDisplayName: "@w205owner", authorChannelId: { value: "UCviewer" }, publishedAt: "2026-10-18T07:00:00Z", videoId: "vid123" } },
        },
        replies: { comments: [
          { id: "UgzThread1.reply1", snippet: { textOriginal: "Yes! Send us your reg", authorDisplayName: "@mkauto", authorChannelId: { value: "UCmk" }, publishedAt: "2026-10-18T08:00:00Z", parentId: "UgzThread1" } },
        ] },
      },
    ],
  };
  it("reads threads and marks the channel's own replies", () => {
    const out = parseYtThreads(ytFixture, account({ platform: "youtube", external_id: "UCmk", handle: "@mkauto" }));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ externalId: "UgzThread1", externalPostId: "vid123", body: "Can you code my W205?", fromSelf: false, postedAt: "2026-10-18T07:00:00.000Z" });
    expect(out[1]).toMatchObject({ parentExternalId: "UgzThread1", fromSelf: true });
  });
  it("classifies Google errors", () => {
    expect(googleError(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }).code).toBe("needs_reauth");
    expect(googleError(403, { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }).code).toBe("rate_limited");
    expect(googleError(403, { error: { message: "nope", errors: [{ reason: "insufficientPermissions" }] } }).code).toBe("needs_reauth");
    expect(googleError(400, { error: { message: "bad", errors: [{ reason: "commentTextTooLong" }] } }).code).toBe("platform");
  });
});

describe("adapters", () => {
  const local = { APP_ORIGIN: "http://localhost:8787" } as Env;
  const prod = { APP_ORIGIN: "https://hub.example.co.uk" } as Env;

  it("mock adapter is deterministic and only used locally", async () => {
    const acc = account({ external_id: "mock_demo_instagram", handle: "mk_auto_demo" });
    const a = await mockAdapter().listNewComments(acc, "");
    const b = await mockAdapter().listNewComments(acc, "");
    expect(a.map(c => c.externalId)).toEqual(b.map(c => c.externalId));
    expect(a).toHaveLength(MOCK_COMMENTS.length);
    expect(a.filter(c => c.fromSelf)).toHaveLength(1);
    expect(getAdapter(local, acc).platform).toBe("mock");
    expect(() => getAdapter(prod, acc)).toThrow(AdapterError);
  });
  it("TikTok explains it isn't available yet", async () => {
    await expect(tiktokAdapter(prod).listNewComments(account({ platform: "tiktok" }), "")).rejects.toMatchObject({ code: "not_configured" });
    await expect(tiktokAdapter({ ...prod, TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" } as Env).reply(account(), {} as never, "x")).rejects.toMatchObject({ code: "not_supported" });
  });
  it("YouTube publishing says it's not supported yet", async () => {
    const yt = getAdapter(prod, account({ platform: "youtube" }));
    await expect(yt.publish!(account({ platform: "youtube" }), {} as never, "")).rejects.toMatchObject({ code: "not_supported" });
  });
  it("post status rolls up from its targets", () => {
    expect(rollUp(["published", "published"])).toBe("published");
    expect(rollUp(["published", "failed"])).toBe("partial");
    expect(rollUp(["queued", "failed"])).toBe("queued");
    expect(rollUp(["failed"])).toBe("failed");
    expect(rollUp([])).toBe("draft");
  });
});

describe("OAuth URLs", () => {
  const env = { APP_ORIGIN: "https://hub.example.co.uk", META_APP_ID: "123", GOOGLE_CLIENT_ID: "g.apps.googleusercontent.com" } as Env;
  it("Facebook Login asks for the page and Instagram scopes with our state", () => {
    const u = new URL(metaAuthUrl(env, "a".repeat(64)));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.pathname).toBe(`/${GRAPH_VERSION}/dialog/oauth`);
    expect(u.searchParams.get("state")).toBe("a".repeat(64));
    expect(u.searchParams.get("redirect_uri")).toBe("https://hub.example.co.uk/api/social/connect/meta/callback");
    for (const s of ["pages_show_list", "pages_manage_engagement", "instagram_manage_comments", "instagram_content_publish", "business_management"]) {
      expect(u.searchParams.get("scope")!.split(",")).toContain(s);
    }
    expect(META_SCOPES).toContain("pages_manage_posts");
  });
  it("Google asks for offline YouTube access", () => {
    const u = new URL(googleAuthUrl(env, "b".repeat(64)));
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("b".repeat(64));
  });
});
