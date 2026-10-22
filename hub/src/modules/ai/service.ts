// Job tool suggestions: AI first (when configured), rules otherwise, always checked and stored.
import type { Env, Lang } from "../../lib/env";
import { audit } from "../../lib/audit";
import { first, newId, now, run } from "../../lib/db";
import { notFound } from "../../lib/http";
import { jobContextForAi } from "../jobs/service";
import { aiAvailable, structured } from "./client";
import { buildPrompt, POLISH_INSTRUCTION, SYSTEM_PROMPT } from "./prompt";
import { rulesSuggestion } from "./rules";
import { sanitiseSuggestion } from "./sanitise";
import { SUGGESTION_JSON_SCHEMA, SuggestionSchema, type Suggestion } from "./schema";

export type SuggestionSource = "ai" | "rules";

export interface StoredSuggestion extends Suggestion {
  id: string;
  job_id: string;
  model: string;
  source: SuggestionSource;
  feedback: "helpful" | "not_helpful" | null;
  created_at: string;
}

interface SuggestionRow { id: string; job_id: string; model: string; response_json: string; feedback: StoredSuggestion["feedback"]; created_at: string }

function fromRow(r: SuggestionRow): StoredSuggestion {
  return { ...(JSON.parse(r.response_json) as Suggestion), id: r.id, job_id: r.job_id, model: r.model, source: r.model === "rules" ? "rules" : "ai", feedback: r.feedback, created_at: r.created_at };
}

export async function latestSuggestion(env: Env, jobId: string): Promise<StoredSuggestion | null> {
  const row = await first<SuggestionRow>(env, "SELECT * FROM ai_suggestions WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", jobId);
  return row ? fromRow(row) : null;
}

export async function suggestForJob(env: Env, jobId: string, actorId: string, lang: Lang = "en"): Promise<{ suggestion: StoredSuggestion; source: SuggestionSource }> {
  const ctx = await jobContextForAi(env, jobId);
  if (!ctx) throw notFound("Job");
  const make = ctx.vehicle?.make ?? null;

  let data: Suggestion | null = null;
  let model = "rules";
  if (aiAvailable(env)) {
    const result = await structured(env, {
      task: "suggestions",
      system: lang === "pl" ? SYSTEM_PROMPT + POLISH_INSTRUCTION : SYSTEM_PROMPT,
      prompt: buildPrompt({ vehicle: ctx.vehicle, job: { title: ctx.job.title, description: ctx.job.description, mileage: ctx.job.mileage }, notes: ctx.notes }),
      schema: SuggestionSchema,
      jsonSchema: SUGGESTION_JSON_SCHEMA,
      effort: "medium",
      maxTokens: 12000,
    });
    if (result) {
      data = sanitiseSuggestion(result.data, { make, lang });
      if (data) model = result.model;
    }
  }
  if (!data) {
    data = rulesSuggestion({
      make, model: ctx.vehicle?.model, fuel_type: ctx.vehicle?.fuel_type,
      title: ctx.job.title, description: ctx.job.description, notes: ctx.notes,
    }, lang);
    model = "rules";
  }

  const id = newId("ais");
  const t = now();
  await run(env, "INSERT INTO ai_suggestions (id, job_id, model, response_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, jobId, model, JSON.stringify(data), actorId, t);
  const source: SuggestionSource = model === "rules" ? "rules" : "ai";
  await audit(env, actorId, "ai.suggest", "job", jobId, { suggestion_id: id, source, lang });
  return { suggestion: { ...data, id, job_id: jobId, model, source, feedback: null, created_at: t }, source };
}

export async function setFeedback(env: Env, id: string, feedback: "helpful" | "not_helpful", actorId: string): Promise<StoredSuggestion> {
  const row = await first<SuggestionRow>(env, "SELECT * FROM ai_suggestions WHERE id = ?", id);
  if (!row) throw notFound("Suggestion");
  await run(env, "UPDATE ai_suggestions SET feedback = ? WHERE id = ?", feedback, id);
  await audit(env, actorId, "ai.feedback", "ai_suggestion", id, { feedback, job_id: row.job_id });
  return fromRow({ ...row, feedback });
}
