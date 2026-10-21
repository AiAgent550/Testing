// Shape of a tool suggestion, as a zod schema (validation) and the matching JSON Schema (sent as the output format).
import { z } from "zod";
import { AVAILABLE_TOOL_NAMES } from "./knowledge";

export const CONFIDENCE = ["low", "medium", "high"] as const;

export const SuggestionSchema = z.object({
  summary: z.string(),
  likely_causes: z.array(z.string()),
  recommended_tools: z.array(z.object({ tool: z.string(), function: z.string(), why: z.string() })),
  steps: z.array(z.string()),
  cautions: z.array(z.string()),
  confidence: z.enum(CONFIDENCE),
  needs_more_info: z.array(z.string()),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

const strArray = (description: string) => ({ type: "array", items: { type: "string" }, description });

/** Structured-output schema: plain types, enums and additionalProperties:false only (no length/number constraints). */
export const SUGGESTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "likely_causes", "recommended_tools", "steps", "cautions", "confidence", "needs_more_info"],
  properties: {
    summary: { type: "string", description: "Two or three sentences: what is probably going on and the plan." },
    likely_causes: strArray("Most likely causes first."),
    recommended_tools: {
      type: "array",
      description: "Only tools from the workshop knowledge base that are AVAILABLE.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "function", "why"],
        properties: {
          tool: { type: "string", enum: [...AVAILABLE_TOOL_NAMES] },
          function: { type: "string", description: "The specific function of that tool to use." },
          why: { type: "string" },
        },
      },
    },
    steps: strArray("Ordered steps for the technician. Back up original data before any write."),
    cautions: strArray("Risks and things to check before acting."),
    confidence: { type: "string", enum: [...CONFIDENCE] },
    needs_more_info: strArray("Questions or checks that would firm up the diagnosis."),
  },
};
