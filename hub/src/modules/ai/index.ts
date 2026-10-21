// Module: ai. Tool suggestions for jobs (Claude when configured, workshop rules otherwise).
// The shared Claude client lives in client.ts; suggestion logic in service.ts.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { json } from "../../lib/http";
import { guard, record } from "../../lib/ratelimit";
import { oneOf, parse } from "../../lib/validate";
import { aiAvailable } from "./client";
import { setFeedback, suggestForJob } from "./service";

async function suggest(ctx: Ctx) {
  const user = userOf(ctx);
  // Each AI answer costs money: cap it per person (rules-only answers are free and not limited).
  if (aiAvailable(ctx.env)) {
    await guard(ctx.env, "ai_suggest", user.id, 40, 60, true);
    await record(ctx.env, "ai_suggest", user.id, true);
  }
  return json(await suggestForJob(ctx.env, ctx.params.jobId, user.id));
}

async function feedback(ctx: Ctx) {
  const input = parse(await ctx.body(), { feedback: oneOf(["helpful", "not_helpful"] as const) });
  return json({ suggestion: await setFeedback(ctx.env, ctx.params.id, input.feedback, userOf(ctx).id) });
}

async function status(ctx: Ctx) {
  return json({ available: aiAvailable(ctx.env) });
}

const ai: Module = {
  name: "ai",
  register(r) {
    r.get("/api/ai/status", status);
    r.post("/api/ai/jobs/:jobId/suggest", suggest);
    r.post("/api/ai/suggestions/:id/feedback", feedback);
  },
};
export default ai;
