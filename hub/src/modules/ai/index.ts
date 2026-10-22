// Module: ai. Tool suggestions for jobs (Claude when configured, workshop rules otherwise).
// The shared Claude client lives in client.ts; suggestion logic in service.ts.
import type { Module } from "../types";
import type { Ctx } from "../../lib/router";
import { userOf } from "../../lib/router";
import { HttpError, json } from "../../lib/http";
import { guard, record } from "../../lib/ratelimit";
import { oneOf, parse, str } from "../../lib/validate";
import { translateText } from "./translate";
import { aiAvailable } from "./client";
import { setFeedback, suggestForJob } from "./service";

async function suggest(ctx: Ctx) {
  const user = userOf(ctx);
  // Each AI answer costs money: cap it per person (rules-only answers are free and not limited).
  if (aiAvailable(ctx.env)) {
    await guard(ctx.env, "ai_suggest", user.id, 40, 60, true);
    await record(ctx.env, "ai_suggest", user.id, true);
  }
  return json(await suggestForJob(ctx.env, ctx.params.jobId, user.id, user.lang));
}

async function feedback(ctx: Ctx) {
  const input = parse(await ctx.body(), { feedback: oneOf(["helpful", "not_helpful"] as const) });
  return json({ suggestion: await setFeedback(ctx.env, ctx.params.id, input.feedback, userOf(ctx).id) });
}

/** Translates a piece of text into the signed-in user's language. Nothing is stored. */
async function translate(ctx: Ctx) {
  const user = userOf(ctx);
  const { text } = parse(await ctx.body(), { text: str({ max: 4000 }) });
  if (!aiAvailable(ctx.env)) {
    throw new HttpError(503, "ai_unavailable", "Translation needs the AI service, which isn't connected yet. Ask for the ANTHROPIC_API_KEY to be added to the Hub.");
  }
  await guard(ctx.env, "ai_translate", user.id, 60, 60, true);
  await record(ctx.env, "ai_translate", user.id, true);
  const translation = await translateText(ctx.env, text, user.lang);
  if (!translation) throw new HttpError(502, "ai_failed", "The translation didn't come back. Try again in a minute.");
  return json({ translation, lang: user.lang });
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
    r.post("/api/ai/translate", translate);
  },
};
export default ai;
