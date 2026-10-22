// Checks a suggestion before it is stored or shown: it must match the schema, every recommended tool
// must be one the garage actually has (and suits the make), and it always reminds about backups.
import { findTool } from "./knowledge";
import { SuggestionSchema, type Suggestion } from "./schema";

const MAX_ITEMS = 12;
const clip = (s: string, n = 600) => {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const list = (xs: string[], n = 600) => xs.map(x => clip(x, n)).filter(Boolean).slice(0, MAX_ITEMS);

export const BACKUP_CAUTION = "Back up the original data (full read, saved and labelled) before any write, coding or adaptation.";
export const BACKUP_CAUTION_PL = "Przed każdym zapisem, kodowaniem lub adaptacją zrób kopię zapasową oryginalnych danych (pełny odczyt, zapisany i opisany).";
const mentionsBackup = (xs: string[]) => xs.some(x =>
  /back\s?-?up|original (file|data|dump)|save (the )?(original|full) (read|dump)/i.test(x) || /kopi\S*\s+zapasow|backup|oryginaln\S*\s+(plik|dan|odczyt)/i.test(x));

/** Returns a clean suggestion, or null if `raw` doesn't match the schema. Unknown or unavailable tools are dropped. */
export function sanitiseSuggestion(raw: unknown, ctx: { make?: string | null; lang?: "en" | "pl" } = {}): Suggestion | null {
  const parsed = SuggestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  const make = (ctx.make || "").toLowerCase().replace(/[^a-z]/g, "");

  const seen = new Set<string>();
  const tools: Suggestion["recommended_tools"] = [];
  for (const r of s.recommended_tools) {
    const t = findTool(r.tool);
    if (!t || t.status !== "available") continue;
    if (t.makes && make && !t.makes.some(m => make.startsWith(m.replace(/[^a-z]/g, "")))) continue;
    const key = `${t.name}|${r.function.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push({ tool: t.name, function: clip(r.function, 300), why: clip(r.why, 400) });
  }

  const steps = list(s.steps);
  const cautions = list(s.cautions);
  if (!mentionsBackup(steps) && !mentionsBackup(cautions)) cautions.unshift(ctx.lang === "pl" ? BACKUP_CAUTION_PL : BACKUP_CAUTION);

  return {
    summary: clip(s.summary, 1200),
    likely_causes: list(s.likely_causes, 300),
    recommended_tools: tools.slice(0, MAX_ITEMS),
    steps,
    cautions: cautions.slice(0, MAX_ITEMS),
    confidence: s.confidence,
    needs_more_info: list(s.needs_more_info, 300),
  };
}
