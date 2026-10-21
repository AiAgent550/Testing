import { describe, expect, it } from "vitest";
import { AVAILABLE_TOOL_NAMES, findTool, KNOWLEDGE } from "../src/modules/ai/knowledge";
import { buildPrompt, redactContacts, SYSTEM_PROMPT } from "../src/modules/ai/prompt";
import { matchRules, rulesSuggestion } from "../src/modules/ai/rules";
import { BACKUP_CAUTION, sanitiseSuggestion } from "../src/modules/ai/sanitise";
import { SUGGESTION_JSON_SCHEMA } from "../src/modules/ai/schema";

const toolsOf = (s: { recommended_tools: { tool: string }[] }) => [...new Set(s.recommended_tools.map(t => t.tool))];
const ALL_TEXT = (s: object) => JSON.stringify(s).toLowerCase();

describe("knowledge base", () => {
  it("has full Mercedes coverage on Abrites and VAG/BMW as coming soon only", () => {
    const merc = findTool("Abrites (Mercedes-Benz)")!;
    expect(merc.status).toBe("available");
    const fns = merc.functions.join(" ");
    for (const f of ["FBS3", "EIS/EZS", "ELV component fault", "FBS4 drive authorisation", "9G-Tronic", "ISM/DSM", "data transfer", "gateway", "IC204", "IC223", "Mileage calibration", "SCN", "Variant coding", "Retrofits", "ASSYST"]) {
      expect(fns).toContain(f);
    }
    expect(findTool("Abrites VAG")!.status).toBe("coming_soon");
    expect(findTool("Abrites BMW")!.status).toBe("coming_soon");
    expect(AVAILABLE_TOOL_NAMES).not.toContain("Abrites (VW Group)");
    expect(AVAILABLE_TOOL_NAMES).toEqual(expect.arrayContaining(["Magic Motorsport Flex", "Transdata", "Ioprog", "VVDI Prog", "Launch X431 IMMO", "Workshop diagnostics"]));
  });
  it("finds tools by alias regardless of case and punctuation", () => {
    expect(findTool("magic motorsport")?.name).toBe("Magic Motorsport Flex");
    expect(findTool("x-431 immo")?.name).toBe("Launch X431 IMMO");
    expect(findTool("Autel IM608")).toBeNull();
  });
  it("offers only available tools in the output schema", () => {
    const items = (SUGGESTION_JSON_SCHEMA.properties as any).recommended_tools.items;
    expect(items.properties.tool.enum).toEqual([...AVAILABLE_TOOL_NAMES]);
    expect(SUGGESTION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(items.additionalProperties).toBe(false);
  });
});

describe("rules fallback", () => {
  const known = new Set(KNOWLEDGE.filter(t => t.status === "available").map(t => t.name));

  it("Mercedes all keys lost -> Abrites FBS3, not the generic key rule", () => {
    const input = { make: "MERCEDES-BENZ", model: "C220", title: "Keys", description: "Customer has lost all keys, C-Class 2012, needs a key made" };
    expect(matchRules(input)).toContain("akl");
    expect(matchRules(input)).not.toContain("keys");
    const s = rulesSuggestion(input);
    expect(toolsOf(s)).toContain("Abrites (Mercedes-Benz)");
    expect(s.recommended_tools.some(t => /all keys lost/i.test(t.function))).toBe(true);
  });
  it("Mercedes steering lock fault -> Abrites ELV function", () => {
    const s = rulesSuggestion({ make: "Mercedes-Benz", title: "No start", description: "Key won't turn, ELV fault on dash, steering lock stuck" });
    expect(s.recommended_tools.some(t => t.tool === "Abrites (Mercedes-Benz)" && /ELV/.test(t.function))).toBe(true);
  });
  it("remap -> Magic Motorsport Flex, with backup and no deletes", () => {
    const s = rulesSuggestion({ make: "Ford", model: "Ranger", title: "Stage 1 remap", description: "Stage 1 please" });
    expect(toolsOf(s)).toEqual(expect.arrayContaining(["Magic Motorsport Flex", "Transdata"]));
    expect(ALL_TEXT(s)).toContain("original file");
    expect(ALL_TEXT(s)).toContain("no dpf, egr or adblue deletes");
  });
  it("Mercedes 7G gearbox -> Abrites gearbox functions", () => {
    const s = rulesSuggestion({ make: "MERCEDES-BENZ", title: "Gearbox", description: "Harsh shifting 7G after fluid change" });
    expect(s.recommended_tools.some(t => t.tool === "Abrites (Mercedes-Benz)" && /7G/.test(t.function))).toBe(true);
  });
  it("cluster swap -> mileage calibration to the true reading only", () => {
    const s = rulesSuggestion({ make: "Mercedes-Benz", title: "Cluster", description: "Replacement IC204 cluster needs adapting" });
    expect(s.recommended_tools.some(t => /Mileage calibration/.test(t.function))).toBe(true);
    expect(ALL_TEXT(s)).toContain("never reduced");
  });
  it("DPF -> diagnostics and a warning that deletes are illegal", () => {
    const s = rulesSuggestion({ make: "Vauxhall", title: "DPF light", description: "DPF light on, limp mode" });
    expect(toolsOf(s)).toContain("Workshop diagnostics");
    expect(ALL_TEXT(s)).toContain("illegal");
  });
  it("VW keys -> no coming-soon Abrites, and says the job may need to wait or be referred", () => {
    const s = rulesSuggestion({ make: "VOLKSWAGEN", model: "Golf", title: "Spare key", description: "Needs a spare key" });
    expect(toolsOf(s).some(t => t.startsWith("Abrites"))).toBe(false);
    expect(ALL_TEXT(s)).toMatch(/wait|referred/);
  });
  it("fault codes don't trigger coding; vague jobs fall back to a full scan with low confidence", () => {
    expect(matchRules({ title: "Check", description: "Read the fault codes please" })).not.toContain("coding");
    const s = rulesSuggestion({ title: "Odd noise", description: "Something feels off" });
    expect(toolsOf(s)).toEqual(["Workshop diagnostics"]);
    expect(s.confidence).toBe("low");
  });
  it("never recommends a Mercedes-only tool for another make", () => {
    const s = rulesSuggestion({ make: "Ford", title: "Airbag light", description: "SRS light on after seat removal" });
    expect(toolsOf(s)).not.toContain("Abrites (Mercedes-Benz)");
  });
  it("only ever recommends tools that exist and are available, always with a backup reminder", () => {
    const cases = ["remap stage 2", "all keys lost", "EIS replacement", "airbag light", "limp mode", "ECU dead no comms", "BSI fault", "CarPlay retrofit", "service reset ASSYST", "gearbox"];
    for (const description of cases) for (const make of ["Mercedes-Benz", "BMW", "Peugeot", null]) {
      const s = rulesSuggestion({ make, title: "Job", description });
      for (const t of s.recommended_tools) expect(known.has(t.tool), `${t.tool} for ${description}/${make}`).toBe(true);
      expect(ALL_TEXT(s)).toMatch(/back ?up|original (file|data)|save/);
    }
  });
});

describe("suggestion sanitiser", () => {
  const base = {
    summary: "ELV fault.", likely_causes: ["ELV motor"], steps: ["Read EIS"], cautions: [], confidence: "medium", needs_more_info: [],
  };
  it("drops tools that aren't in the knowledge base or are coming soon, and canonicalises names", () => {
    const s = sanitiseSuggestion({
      ...base,
      recommended_tools: [
        { tool: "abrites", function: "ESL/ELV reset", why: "Mercedes ELV" },
        { tool: "Autel IM608", function: "Keys", why: "Not ours" },
        { tool: "Abrites (VW Group)", function: "MQB keys", why: "Coming soon" },
        { tool: "Launch X431 IMMO", function: "Scan", why: "Scan" },
      ],
    }, { make: "Mercedes-Benz" })!;
    expect(toolsOf(s)).toEqual(["Abrites (Mercedes-Benz)", "Launch X431 IMMO"]);
  });
  it("drops make-specific tools for the wrong make", () => {
    const s = sanitiseSuggestion({ ...base, recommended_tools: [{ tool: "Abrites (Mercedes-Benz)", function: "Keys", why: "x" }] }, { make: "Ford" })!;
    expect(s.recommended_tools).toEqual([]);
  });
  it("adds the backup reminder when the answer forgot it", () => {
    const s = sanitiseSuggestion({ ...base, recommended_tools: [] })!;
    expect(s.cautions[0]).toBe(BACKUP_CAUTION);
    const withBackup = sanitiseSuggestion({ ...base, steps: ["Back up the EIS data"], recommended_tools: [] })!;
    expect(withBackup.cautions).not.toContain(BACKUP_CAUTION);
  });
  it("rejects schema-invalid output", () => {
    expect(sanitiseSuggestion(null)).toBeNull();
    expect(sanitiseSuggestion({ summary: "x" })).toBeNull();
    expect(sanitiseSuggestion({ ...base, recommended_tools: [], confidence: "certain" })).toBeNull();
    expect(sanitiseSuggestion({ ...base, recommended_tools: [{ tool: "Ioprog" }] })).toBeNull();
    expect(sanitiseSuggestion({ ...base, recommended_tools: "Ioprog" })).toBeNull();
  });
});

describe("prompt builder", () => {
  const input = {
    vehicle: { make: "MERCEDES-BENZ", model: "C 220 D", year: 2015, fuel_type: "DIESEL", engine_cc: 2143, vin: "WDD2050042F123456" },
    job: { title: "Keys and immobiliser · WR70 XYZ", description: "All keys lost. Call Dave on 07700 900123 or dave@example.com when done.", mileage: 98000 },
    notes: ["EIS reads ok", "Customer says ring +44 7700 900456 first"],
  };
  const prompt = buildPrompt(input);

  it("includes the vehicle, job, notes and the knowledge base", () => {
    for (const s of ["MERCEDES-BENZ", "C 220 D", "2015", "DIESEL", "2143 cc", "WDD2050042F123456", "98000", "All keys lost", "EIS reads ok", "Abrites (Mercedes-Benz)", "COMING SOON"]) {
      expect(prompt).toContain(s);
    }
  });
  it("never contains customer contact details", () => {
    for (const s of ["07700 900123", "dave@example.com", "+44 7700 900456", "7700900123"]) expect(prompt).not.toContain(s);
    expect(prompt).toContain("[phone removed]");
    expect(prompt).toContain("[email removed]");
  });
  it("redacts common UK phone formats and leaves VINs and part numbers alone", () => {
    expect(redactContacts("ring 01905 123456 or 07700900123")).toBe("ring [phone removed] or [phone removed]");
    expect(redactContacts("VIN WDD2050042F123456, part A0009050030")).toBe("VIN WDD2050042F123456, part A0009050030");
  });
  it("flags coming-soon makes in the prompt", () => {
    expect(buildPrompt({ ...input, vehicle: { ...input.vehicle, make: "BMW" } })).toContain('covered by "Abrites (BMW and MINI)", which is COMING SOON');
  });
  it("system prompt carries the safety and scope rules", () => {
    for (const s of ["ONLY tools", "advisory only", "backing up the original data", "mileage reduction", "immobiliser removal", "DPF, EGR", "British English"]) {
      expect(SYSTEM_PROMPT).toContain(s);
    }
  });
});
