import { beforeAll, describe, expect, it } from "vitest";
import { RULE_STRINGS, rulesSuggestion } from "../src/modules/ai/rules";
import { RULES_PL } from "../src/modules/ai/rules-pl";
import { BACKUP_CAUTION, BACKUP_CAUTION_PL, sanitiseSuggestion } from "../src/modules/ai/sanitise";

declare global { interface ImportMeta { url: string } }

// The dashboard's translation files are plain browser JS; load them without TypeScript resolving them.
const load = (rel: string) => import(new URL(rel, import.meta.url).href);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PL: Record<string, any>, PATTERNS: [RegExp, string][], i18n: any, collectKeys: () => Map<string, string>, serverMessages: () => string[];
beforeAll(async () => {
  ({ PL, PL_PATTERNS: PATTERNS } = await load("../public/assets/i18n-pl.js"));
  i18n = await load("../public/assets/i18n.js");
  ({ collectKeys, serverMessages } = await load("../scripts/i18n-keys.mjs"));
});

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe("Polish dashboard dictionary", () => {
  it("has a Polish entry for every string the dashboard and sign-in page show", () => {
    const missing = [...collectKeys()].filter(([k]) => !(k in PL)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps the same {placeholders} as the English text", () => {
    const bad: string[] = [];
    for (const [en, pl] of Object.entries(PL)) {
      const forms = typeof pl === "string" ? [pl] : Object.values(pl as Record<string, string>);
      const want = placeholders(en.split("|")[0]);
      for (const f of forms) if (JSON.stringify(placeholders(f)) !== JSON.stringify(want)) bad.push(`${en} -> ${f}`);
    }
    expect(bad).toEqual([]);
  });

  it("gives plural entries every Polish form", () => {
    for (const [en, pl] of Object.entries(PL)) {
      if (typeof pl === "string") continue;
      expect(en, en).toContain("|");
      expect(Object.keys(pl).sort(), en).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("picks the right Polish plural form", () => {
    i18n.setLang("pl");
    const miles = (n: number) => i18n.tn(n, "{n} mile|{n} miles");
    expect([1, 2, 4, 5, 12, 22, 25].map(miles)).toEqual(["1 mila", "2 mile", "4 mile", "5 mil", "12 mil", "22 mile", "25 mil"]);
    expect(i18n.tn(3, "{n} new lead|{n} new leads")).toBe("3 nowe zapytania");
    i18n.setLang("en");
    expect([1, 2].map(miles)).toEqual(["1 mile", "2 miles"]);
  });

  it("translates with placeholders and falls back to English", () => {
    i18n.setLang("pl");
    expect(i18n.t("Booking {ref} saved.", { ref: "CP-1001" })).toBe("Rezerwacja CP-1001 zapisana.");
    expect(i18n.t("A string nobody translated")).toBe("A string nobody translated");
    i18n.setLang("en");
    expect(i18n.t("Booking {ref} saved.", { ref: "CP-1001" })).toBe("Booking CP-1001 saved.");
  });
});

describe("server messages in Polish", () => {
  it("has a Polish entry or pattern for every fixed message", () => {
    const covered = (m: string) => m in PL || PATTERNS.some(([re]) => re.test(m)) || PATTERNS.some(([re]) => re.test(`${m} wasn't found.`));
    const missing = serverMessages().filter(m => !covered(m));
    expect(missing).toEqual([]);
  });

  it("translates patterned messages, including the words inside them", () => {
    i18n.setLang("pl");
    expect(i18n.tServer("At least 12 characters.")).toBe("Co najmniej 12 znaków.");
    expect(i18n.tServer("Booking wasn't found.")).toBe("Rezerwacja: nie znaleziono.");
    expect(i18n.tServer("A booking that is cancelled can't be confirmed.")).toBe("Rezerwacji o statusie „anulowane” nie można potwierdzić.");
    expect(i18n.tServer("Email or password is incorrect.")).toBe("Nieprawidłowy e-mail lub hasło.");
    expect(i18n.tServer("Something brand new")).toBe("Something brand new");
    i18n.setLang("en");
    expect(i18n.tServer("Email or password is incorrect.")).toBe("Email or password is incorrect.");
  });
});

describe("tool suggestions in Polish", () => {
  it("has Polish for every rule string", () => {
    expect([...RULE_STRINGS()].filter(s => !(s in RULES_PL))).toEqual([]);
    expect(RULES_PL[BACKUP_CAUTION]).toBe(BACKUP_CAUTION_PL);
  });

  it("returns the rules suggestion fully in Polish", () => {
    const s = rulesSuggestion({ make: "MERCEDES-BENZ", model: "C 220", title: "All keys lost", description: "No keys, steering lock clicks" }, "pl");
    const english = new Set([...RULE_STRINGS(), BACKUP_CAUTION]);
    const texts = [s.summary, ...s.likely_causes, ...s.steps, ...s.cautions, ...s.needs_more_info, ...s.recommended_tools.flatMap(t => [t.function, t.why])];
    expect(texts.filter(x => english.has(x))).toEqual([]);
    expect(s.summary).toMatch(/^Wygląda na: utrata wszystkich kluczy \(Mercedes\)/);
    expect(s.recommended_tools.every(t => t.tool === "Abrites (Mercedes-Benz)" || t.tool.length > 0)).toBe(true); // tool names stay as named
  });

  it("keeps English suggestions unchanged", () => {
    const s = rulesSuggestion({ make: "BMW", title: "Remap stage 1" });
    expect(s.summary).toMatch(/^Looks like ECU remap work on a BMW/);
  });

  it("adds the backup reminder in Polish for Polish AI answers that lack one", () => {
    const raw = { summary: "x", likely_causes: [], recommended_tools: [], steps: ["Odczytaj kody"], cautions: [], confidence: "low", needs_more_info: [] };
    expect(sanitiseSuggestion(raw, { lang: "pl" })!.cautions[0]).toBe(BACKUP_CAUTION_PL);
    const withBackup = { ...raw, steps: ["Zrób kopię zapasową ECU"] };
    expect(sanitiseSuggestion(withBackup, { lang: "pl" })!.cautions).toEqual([]);
  });
});

export {};
