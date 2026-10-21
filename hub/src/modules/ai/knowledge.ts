// The garage's real kit and what it can do, written as data. Tool suggestions (AI and rules)
// may only recommend tools listed here as available; "coming soon" licences are never offered.
// Sources: the workshop section of the website (equipment) and the make-by-make page (Abrites coverage).

export type ToolStatus = "available" | "coming_soon";

export interface KnowledgeTool {
  /** Canonical name, exactly as suggestions must name it. */
  name: string;
  status: ToolStatus;
  /** Other ways people (or the model) might write the name; matched case- and punctuation-insensitively. */
  aliases: string[];
  summary: string;
  /** Makes this tool's functions are limited to, when it is make-specific. */
  makes?: string[];
  functions: string[];
}

export const KNOWLEDGE: readonly KnowledgeTool[] = [
  {
    name: "Magic Motorsport Flex",
    status: "available",
    aliases: ["Magic Motorsport", "MagicMotorsport", "Flex", "MM Flex"],
    summary: "ECU and gearbox (TCU) read/write via OBD, on the bench and in boot mode.",
    functions: [
      "ECU read/write via OBD for remaps (stage 1 / stage 2 calibrations)",
      "TCU (gearbox controller) read/write via OBD, bench or boot",
      "Bench and boot mode reading of ECUs that are locked on OBD",
      "Full backup of original ECU/TCU data before any write",
      "Checksum correction and recovery writes of the original file",
    ],
  },
  {
    name: "Transdata",
    status: "available",
    aliases: ["Trans data", "Transdata Pro"],
    summary: "Bench and boot ECU programming.",
    functions: [
      "Bench reading/writing of ECUs",
      "Boot mode reading/writing of ECUs",
      "Recovery of ECUs after a failed write",
      "Full backup of ECU flash and EEPROM",
    ],
  },
  {
    name: "Ioprog",
    status: "available",
    aliases: ["IO prog", "I/O Prog", "Ioprog Godiag"],
    summary: "ECU, BSI and EEPROM programming.",
    functions: [
      "ECU reading/writing on the bench",
      "BSI (body systems interface) reading/writing, e.g. PSA BSI",
      "EEPROM reading/writing for module data and immobiliser data",
      "Virginising and cloning of modules where supported",
    ],
  },
  {
    name: "VVDI Prog",
    status: "available",
    aliases: ["VVDI", "Xhorse VVDI Prog", "VVDIProg"],
    summary: "EEPROM and MCU reading for keys and modules.",
    functions: [
      "EEPROM reading/writing (e.g. 24Cxx, 93Cxx, 95xxx) from immobiliser, cluster and airbag modules",
      "MCU reading for key and immobiliser data",
      "Saving a full dump of the original EEPROM/MCU before any change",
      "Preparing dealer keys from module data",
    ],
  },
  {
    name: "Launch X431 IMMO",
    status: "available",
    aliases: ["Launch X431", "X431 IMMO", "X431", "Launch"],
    summary: "Key programming and immobiliser functions, plus full-system diagnostics.",
    functions: [
      "Key programming (add key, all keys lost) on supported makes",
      "Immobiliser data reading and adaptation",
      "Remote/transponder learning",
      "Full-system fault code scan and live data",
    ],
  },
  {
    name: "Abrites (Mercedes-Benz)",
    status: "available",
    aliases: ["Abrites", "Abrites Mercedes", "AVDI", "Abrites AVDI", "Abrites Mercedes-Benz", "Abrites MB"],
    summary: "Full Mercedes-Benz coverage, including AMG, Smart and vans.",
    makes: ["mercedes", "mercedes-benz", "smart", "amg"],
    functions: [
      "FBS3 keys: spare keys and all keys lost on DAS 2, 2a, 2b and 3 cars, by OBD or on the bench, including infrared keys",
      "EIS/EZS: password reading, plus renewal, personalisation and activation of new or used ignition switches",
      "ESL/ELV steering lock: replacement and reset, including the FBS4 \"ELV component fault\" that locks the steering",
      "FBS4 drive authorisation: reset, personalise and activate replacement engine ECUs so the car starts, with or without data from the original unit",
      "7G and 9G-Tronic: virgin reset and personalisation of VGS4 (7G), VGS NAG3 (9G) and DCT controllers, FBS4 cars included",
      "ISM/DSM: replacement, adaptation and data transfer for gear selector modules, new or used",
      "ECU renewal and data transfer: read, save and move drive authorisation and coding data from a failed unit to its replacement",
      "Airbag and gateway data: read and update configuration data in airbag units and the central gateway",
      "Cluster replacement: adaptation of replacement clusters on FBS3 cars and FBS4 clusters including IC204, IC172, IC213, IC222, IC177 and IC223",
      "Mileage calibration: set a replacement cluster or module to the car's true recorded mileage",
      "SCN coding: online-free SCN coding over OBD so retrofitted and replaced parts work as the factory intended",
      "Variant coding: read, change and restore variant coding on any module",
      "Retrofits: Apple CarPlay, front and 360 cameras, AMG start screen, sunroof and seat settings",
      "Service functions: ASSYST resets, 7G-Tronic adaptation reset, SBC brake counter reset, DPF regeneration, electronic parking brake",
      "Hybrid batteries: battery reset and unlock on mild and plug-in hybrid models",
    ],
  },
  {
    name: "Abrites (VW Group)",
    status: "coming_soon",
    aliases: ["Abrites VAG", "Abrites VW", "Abrites Audi", "Abrites VW Group"],
    summary: "VW, Audi, SEAT, Skoda and Cupra licence: NOT available yet (coming soon).",
    makes: ["volkswagen", "vw", "audi", "seat", "skoda", "cupra", "porsche"],
    functions: ["MQB/NCF keys, component protection, cluster replacement, DSG/ECU adaptation (once licensed)"],
  },
  {
    name: "Abrites (BMW and MINI)",
    status: "coming_soon",
    aliases: ["Abrites BMW", "Abrites MINI", "Abrites BMW and MINI"],
    summary: "BMW and MINI licence: NOT available yet (coming soon).",
    makes: ["bmw", "mini"],
    functions: ["CAS/FEM/BDC keys, ISN, vehicle order, module replacement and coding (once licensed)"],
  },
  {
    name: "Workshop diagnostics",
    status: "available",
    aliases: ["General diagnostics", "Diagnostics", "Workshop diagnostic equipment", "Multimeter", "Diagnostic scan"],
    summary: "General workshop diagnostics: fault code scan, live data, wiring, power and earth checks, mechanical inspection.",
    functions: [
      "Full-system fault code scan and freeze-frame review",
      "Live data checks (sensors, boost, fuel trims, temperatures)",
      "Battery, charging, power supply and earth checks",
      "Wiring and connector inspection, continuity and voltage tests",
      "Road test and mechanical inspection",
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Finds a tool by name or alias (case and punctuation ignored). */
export function findTool(name: string): KnowledgeTool | null {
  const n = norm(name);
  if (!n) return null;
  for (const t of KNOWLEDGE) if (norm(t.name) === n) return t;
  for (const t of KNOWLEDGE) if (t.aliases.some(a => norm(a) === n)) return t;
  return null;
}

export const availableTools = () => KNOWLEDGE.filter(t => t.status === "available");
export const AVAILABLE_TOOL_NAMES: readonly string[] = KNOWLEDGE.filter(t => t.status === "available").map(t => t.name);

/** Makes the garage can't fully cover yet (licence coming soon). */
export function comingSoonFor(make: string | null | undefined): KnowledgeTool | null {
  if (!make) return null;
  const m = norm(make);
  return KNOWLEDGE.find(t => t.status === "coming_soon" && t.makes?.some(x => norm(x) === m || m.startsWith(norm(x)))) ?? null;
}

/** The knowledge base as plain text for the prompt. */
export function knowledgeText(): string {
  const lines: string[] = [];
  for (const t of KNOWLEDGE) {
    lines.push(`## ${t.name} [${t.status === "available" ? "AVAILABLE" : "COMING SOON - NOT AVAILABLE, never recommend"}]`);
    lines.push(t.summary);
    for (const f of t.functions) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
