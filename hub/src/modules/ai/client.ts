// Shared Claude client. Every AI feature (tool suggestions, lead triage) goes through structured()
// so they share one model choice, one refusal policy and one way of failing gracefully.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Env } from "../../lib/env";

export const AI_MODEL = "claude-opus-5-5";

export const aiAvailable = (env: Env) => !!env.ANTHROPIC_API_KEY;

export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  prompt: string;
  schema: T;
  /** JSON Schema for the same shape, sent as the output format. */
  jsonSchema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

/**
 * Ask Claude for JSON matching `schema`. Returns null when AI isn't configured, when the
 * request is declined, or when the answer doesn't validate, so callers always have a
 * non-AI fallback path and the Hub keeps working without a key.
 */
export async function structured<T extends z.ZodType>(env: Env, req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>> | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  try {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: {
        effort: req.effort ?? "medium",
        format: { type: "json_schema", schema: req.jsonSchema },
      },
      // On a policy decline the API retries on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const text = response.content.find(b => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = req.schema.safeParse(JSON.parse(text.text));
    if (!parsed.success) return null;
    return { data: parsed.data, model: response.model };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("AI rate limited");
    else if (err instanceof Anthropic.AuthenticationError) console.error("AI key rejected");
    else if (err instanceof Anthropic.APIError) console.error(`AI error ${err.status}`);
    else console.error("AI request failed", err);
    return null;
  }
}
