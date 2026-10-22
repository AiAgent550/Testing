// Rules-based tool suggestions: keyword matching on the job text plus the vehicle make.
// Used when AI isn't configured or doesn't answer, so "Ask AI" always gives a useful starting point.
import { comingSoonFor } from "./knowledge";
import { sanitiseSuggestion } from "./sanitise";
import type { Suggestion } from "./schema";
import type { Lang } from "../../lib/env";
import { RULES_PL } from "./rules-pl";

export interface RulesInput {
  make?: string | null;
  model?: string | null;
  fuel_type?: string | null;
  title: string;
  description?: string | null;
  notes?: string[];
}

type Tool = Suggestion["recommended_tools"][number];
interface Piece { label: string; causes: string[]; tools: Tool[]; steps: string[]; cautions: string[]; more: string[] }
interface Ctx { mercedes: boolean }
interface Rule { id: string; test: RegExp; build(ctx: Ctx): Piece }

const T = (tool: string, fn: string, why: string): Tool => ({ tool, function: fn, why });
const AB = "Abrites (Mercedes-Benz)", FLEX = "Magic Motorsport Flex", TD = "Transdata", IO = "Ioprog",
  VVDI = "VVDI Prog", X431 = "Launch X431 IMMO", DIAG = "Workshop diagnostics";

const RULES: Rule[] = [
  {
    id: "akl",
    test: /\b(all keys? lost|akl|no keys?|lost (all|both) keys|lost keys)\b/,
    build: ({ mercedes }) => mercedes ? {
      label: "all keys lost (Mercedes)",
      causes: ["No working key: the EIS/EZS needs a new key made from its data"],
      tools: [T(AB, "FBS3 keys: all keys lost by OBD or on the bench", "Abrites covers all keys lost on DAS 2, 2a, 2b and 3 (FBS3) cars"),
        T(AB, "EIS/EZS: password reading", "The key password comes from the ignition switch")],
      steps: ["Confirm the car is FBS3 (not FBS4) from the year and EIS type", "Read and save the EIS/EZS data before anything else",
        "Calculate the password with Abrites and write the new key", "Test start, remote locking and the ELV"],
      cautions: ["FBS4 cars can't have keys made this way: keys come from the dealer", "Check proof of ownership before making keys"],
      more: ["Year and model, and whether the car is FBS3 or FBS4", "V5C and ID matching the owner"],
    } : {
      label: "all keys lost",
      causes: ["No working key: immobiliser data must be read to make a new one"],
      tools: [T(X431, "All keys lost key programming", "Covers all keys lost on many makes by OBD"),
        T(VVDI, "EEPROM/MCU read of the immobiliser module", "When OBD isn't supported, the key data comes from the module on the bench")],
      steps: ["Check X431 IMMO coverage for this make, model and year", "Back up immobiliser data (OBD or EEPROM dump) before any write",
        "Program the new key(s) and test start and remote"],
      cautions: ["Check proof of ownership before making keys"],
      more: ["Year, model and key type (blade, flip, proximity)", "V5C and ID matching the owner"],
    },
  },
  {
    id: "keys",
    test: /\b(keys?|spare key|fob|remote|transponder|immobili[sz]er|immo|key ?less)\b/,
    build: ({ mercedes }) => mercedes ? {
      label: "keys and immobiliser (Mercedes)",
      causes: ["Key not recognised by the EIS/EZS", "Worn or damaged key, or a flat key battery", "EIS/EZS fault"],
      tools: [T(AB, "FBS3 keys: spare key by OBD or on the bench", "Abrites writes FBS3 keys including infrared keys"),
        T(AB, "EIS/EZS: password reading, renewal and personalisation", "Needed for keys and for replacement ignition switches")],
      steps: ["Scan the EIS/EZS and check its fault codes", "Read and save the EIS data", "Make and write the key, then test start and remote"],
      cautions: ["FBS4 keys can only come from the dealer", "Check proof of ownership before making keys"],
      more: ["How many working keys there are", "Year and whether the car is FBS3 or FBS4"],
    } : {
      label: "keys and immobiliser",
      causes: ["Key not programmed or not recognised", "Flat key battery or damaged transponder", "Immobiliser module fault"],
      tools: [T(X431, "Add key / immobiliser adaptation", "Key programming and immobiliser functions by OBD"),
        T(VVDI, "EEPROM/MCU read for key data", "Fallback when the car isn't covered on OBD")],
      steps: ["Scan for immobiliser fault codes", "Back up immobiliser data before writing", "Program the key and test start, remote and locking"],
      cautions: ["Check proof of ownership before making keys"],
      more: ["How many working keys there are", "Key type and year"],
    },
  },
  {
    id: "elv",
    test: /\b(elv|esl|steering (lock|column lock)|steering locked|elv component fault)\b/,
    build: ({ mercedes }) => ({
      label: "steering lock",
      causes: ["ESL/ELV motor or electronics failure", "FBS4 \"ELV component fault\"", "Low battery voltage during locking"],
      tools: mercedes
        ? [T(AB, "ESL/ELV steering lock: replacement and reset, incl. FBS4 ELV component fault", "Abrites resets and adapts replacement ELVs on Mercedes"),
          T(DIAG, "Battery, power supply and earth checks", "Low voltage often triggers ELV faults")]
        : [T(DIAG, "Fault code scan, power and earth checks", "Confirm the lock and its supply before replacing parts")],
      steps: ["Check battery voltage and the ELV supply and earth", "Read fault codes from the EIS and ELV", "Back up EIS/ELV data before replacing or resetting", "Replace or reset the ELV and test lock/unlock several times"],
      cautions: ["Make sure the steering unlocks reliably before the car leaves"],
      more: ["Exact fault codes and whether the key turns / the car starts"],
    }),
  },
  {
    id: "eis",
    test: /\b(eis|ezs|ignition switch|ignition barrel)\b/,
    build: ({ mercedes }) => ({
      label: "ignition switch",
      causes: ["EIS/EZS failure or worn ignition switch"],
      tools: mercedes
        ? [T(AB, "EIS/EZS: password reading, renewal, personalisation and activation", "Lets a new or used EIS be matched to the car")]
        : [T(X431, "Immobiliser adaptation", "Matching a replacement ignition/immobiliser unit"), T(VVDI, "EEPROM read of the old unit", "Recover data from the original unit")],
      steps: ["Read and save data from the original unit", "Fit and personalise the replacement", "Teach keys and test start"],
      cautions: [],
      more: ["Is the original unit readable?"],
    }),
  },
  {
    id: "remap",
    test: /\b(remap(ped|ping)?|stage ?[123]|tun(e|ed|ing)|ecu tune|more power|economy map)\b/,
    build: () => ({
      label: "ECU remap",
      causes: [],
      tools: [T(FLEX, "ECU read/write via OBD", "Reads and writes the engine ECU for the calibration"),
        T(FLEX, "Bench and boot mode", "For ECUs locked on OBD"), T(TD, "Bench/boot ECU programming", "Alternative bench/boot route and recovery")],
      steps: ["Health check first: scan for faults, check live data, boost and fuel trims, and fix any issues", "Read the ECU and save the original file (label it with reg and date)",
        "Write the calibration and clear adaptations if needed", "Road test, log data and check for faults"],
      cautions: ["Don't remap a car with existing faults", "Tell the customer to declare the modification to their insurer", "No DPF, EGR or AdBlue deletes"],
      more: ["ECU type and software number", "Any existing modifications"],
    }),
  },
  {
    id: "gearbox",
    test: /\b(gear ?box|transmission|7g|9g|722\.\d|tcu|vgs|nag3|dct|dsg|shift(ing)?|gear change|gears?)\b/,
    build: ({ mercedes }) => mercedes ? {
      label: "gearbox (Mercedes)",
      causes: ["Gearbox controller (VGS/TCU) fault", "Adaptations out after work", "Selector module (ISM/DSM) fault", "Low or old fluid, worn conductor plate"],
      tools: [T(AB, "7G and 9G-Tronic: virgin reset and personalisation of VGS4 / VGS NAG3 / DCT", "For replacement or used gearbox controllers"),
        T(AB, "Service functions: 7G-Tronic adaptation reset", "After fluid service or controller work"),
        T(AB, "ISM/DSM: replacement, adaptation and data transfer", "If the selector module is the fault"),
        T(DIAG, "Fault code scan and live data", "Find the fault before replacing parts")],
      steps: ["Scan the TCU and selector, note codes and fluid temperature", "Check fluid level and condition", "Back up the TCU data before any reset or replacement", "Reset adaptations or fit and personalise the replacement, then road test"],
      cautions: [],
      more: ["Fault codes and symptoms (harsh shift, no drive, limp)"],
    } : {
      label: "gearbox",
      causes: ["Gearbox controller fault", "Adaptations out after work", "Fluid level or condition"],
      tools: [T(DIAG, "Fault code scan and live data", "Find the fault before replacing parts"), T(FLEX, "TCU read/write via OBD, bench or boot", "Back up or recover the gearbox controller")],
      steps: ["Scan the gearbox controller and note codes", "Check fluid level and condition", "Back up TCU data before any write", "Road test"],
      cautions: [],
      more: ["Fault codes and when the symptom happens"],
    },
  },
  {
    id: "cluster",
    test: /\b(cluster|speedo(meter)?|instrument|clocks|odometer|dash(board)?|ic(204|172|213|222|177|223))\b/,
    build: ({ mercedes }) => ({
      label: "instrument cluster",
      causes: ["Cluster failure (display, gauges, stepper motors)", "Replacement cluster not adapted to the car"],
      tools: mercedes
        ? [T(AB, "Cluster replacement (FBS3, and FBS4 IC204/IC172/IC213/IC222/IC177/IC223)", "Adapts a replacement cluster to the car"),
          T(AB, "Mileage calibration", "Sets the replacement cluster to the car's true recorded mileage")]
        : [T(VVDI, "EEPROM/MCU read of the original cluster", "Keeps the original data, including immobiliser data where held in the cluster")],
      steps: ["Record the true mileage with evidence (original cluster reading, MOT history, service records)", "Back up the original cluster data",
        "Fit and adapt the replacement", "Check the displayed mileage matches the true recorded mileage"],
      cautions: ["Mileage may only ever be set to the car's true recorded mileage, never reduced", "Keep a record of the before and after readings"],
      more: ["True mileage evidence", "Is the original cluster readable?"],
    }),
  },
  {
    id: "airbag",
    test: /\b(airbag|srs|crash data|seat belt pretensioner|occupant sensor)\b/,
    build: ({ mercedes }) => ({
      label: "airbag / SRS",
      causes: ["Crash data stored after deployment", "Seat or clockspring wiring fault", "Configuration mismatch after a module swap"],
      tools: [
        ...(mercedes ? [T(AB, "Airbag and gateway data: read and update configuration", "Correct configuration after module replacement")] : []),
        T(DIAG, "SRS fault code scan and wiring checks", "Find the actual fault (connectors under seats, clockspring)"),
        T(VVDI, "EEPROM read and backup of the airbag module", "Keep the original data before any change"),
      ],
      steps: ["Scan SRS codes", "Check seat connectors, clockspring and resistances with the battery disconnected", "Back up module data before any write", "Clear codes and confirm the light goes out"],
      cautions: ["Replace all deployed parts: never defeat or bypass the SRS", "Disconnect the battery and wait before unplugging airbag parts"],
      more: ["SRS fault codes", "Has the car had a collision?"],
    }),
  },
  {
    id: "dpf",
    test: /\b(dpf|particulate|regen(eration)?|soot)\b/,
    build: ({ mercedes }) => ({
      label: "DPF",
      causes: ["Blocked DPF from short journeys", "Faulty differential pressure sensor or pipes", "Underlying fault stopping regeneration (EGR, injectors, thermostat)"],
      tools: [T(DIAG, "Live data: soot load, differential pressure, temperatures", "Find why it isn't regenerating"),
        ...(mercedes ? [T(AB, "Service functions: DPF regeneration", "Forced regeneration once the cause is fixed")] : [])],
      steps: ["Scan and check soot load and pressure sensor readings", "Fix the underlying cause first", "Run a forced regeneration or clean the DPF", "Road test and recheck soot load"],
      cautions: ["DPF removal or delete is illegal on UK roads and fails the MOT: repair or clean it"],
      more: ["Journey pattern and fault codes"],
    }),
  },
  {
    id: "egr",
    test: /\b(egr|adblue|scr|nox)\b/,
    build: () => ({
      label: "EGR / AdBlue",
      causes: ["Sticking EGR valve or cooler", "AdBlue pump, heater or NOx sensor fault"],
      tools: [T(DIAG, "Fault code scan and live data", "Confirm the faulty component")],
      steps: ["Scan and note codes", "Test the component and its wiring", "Repair or replace and run any adaptations"],
      cautions: ["EGR, AdBlue or SCR deletes are illegal on UK roads: repair the system"],
      more: ["Fault codes and mileage"],
    }),
  },
  {
    id: "limp",
    test: /\b(limp|loss of power|lack of power|no power|eml|engine (warning )?light|check engine|misfir(e|ing)|boost|turbo|cuts? out|stall(s|ing)?|won'?t start|non[- ]?start|no start|cranks?)\b/,
    build: () => ({
      label: "running fault",
      causes: ["Sensor or actuator fault putting the engine in limp mode", "Boost leak or turbo actuator fault", "Fuel supply or injector issue"],
      tools: [T(DIAG, "Full-system fault code scan, freeze frame and live data", "Narrow down the fault before replacing parts"),
        T(X431, "Full-system scan", "Scan every module, not just the engine")],
      steps: ["Scan all modules and save the report", "Check freeze-frame data and live data under load", "Check for boost leaks, wiring and connectors", "Repair, clear codes and road test"],
      cautions: [],
      more: ["Fault codes and when the fault happens (cold, under load, at speed)"],
    }),
  },
  {
    id: "ecu",
    test: /\b(ecu (replacement|swap|dead|faulty|failed)|replacement ecu|used ecu|second.?hand ecu|no comms?|no communication|drive authori[sz]ation|fbs4|ecu clone|clone)\b/,
    build: ({ mercedes }) => mercedes ? {
      label: "ECU replacement (Mercedes)",
      causes: ["Failed engine ECU", "Replacement ECU not personalised to the car (FBS4)"],
      tools: [T(AB, "FBS4 drive authorisation: reset, personalise and activate replacement engine ECU", "Makes a replacement ECU start the car"),
        T(AB, "ECU renewal and data transfer", "Moves drive authorisation and coding data from the old unit"),
        T(FLEX, "Bench/boot read of the original ECU", "Full backup of the original unit")],
      steps: ["Confirm the ECU really is at fault (power, earth, CAN)", "Read and save data from the original ECU", "Fit, personalise and code the replacement", "Test start and clear codes"],
      cautions: [],
      more: ["Part and software numbers of both units", "Is the original unit readable?"],
    } : {
      label: "ECU replacement",
      causes: ["Failed ECU", "Power, earth or CAN wiring fault"],
      tools: [T(TD, "Bench/boot ECU programming", "Read the original unit and write the replacement"),
        T(IO, "ECU and EEPROM programming", "Clone immobiliser and coding data to the replacement"),
        T(VVDI, "EEPROM/MCU read", "Recover immobiliser data from the original")],
      steps: ["Check power, earth and CAN to the ECU", "Read and save the original ECU fully", "Clone or adapt to the replacement and test start"],
      cautions: [],
      more: ["Part and software numbers of both units"],
    },
  },
  {
    id: "coding",
    test: /\b(coding|coded|code (it|in|the)|scn|variant coding|retrofit(ted|s)?|carplay|android auto|camera|start screen|sunroof)\b/,
    build: ({ mercedes }) => ({
      label: "coding and retrofits",
      causes: ["Replaced or retrofitted part not coded"],
      tools: mercedes
        ? [T(AB, "SCN coding", "Online-free SCN coding over OBD for replaced or retrofitted parts"),
          T(AB, "Variant coding: read, change and restore", "Change module options and keep the original coding"),
          T(AB, "Retrofits: Apple CarPlay, cameras, AMG start screen, sunroof, seats", "Supported retrofit functions")]
        : [T(DIAG, "Module scan to confirm part numbers and faults", "Check what is fitted before coding")],
      steps: ["Save the original coding of every module you touch", "Apply the coding change", "Clear codes and test the function"],
      cautions: [],
      more: ["Exactly what was fitted or replaced"],
    }),
  },
  {
    id: "bsi",
    test: /\b(bsi|bcm|body control|comfort module)\b/,
    build: () => ({
      label: "body module",
      causes: ["BSI/BCM fault or corrupted data"],
      tools: [T(IO, "BSI reading/writing", "Read, repair or clone body module data"), T(VVDI, "EEPROM read", "Back up the module EEPROM")],
      steps: ["Back up the original module data", "Repair or clone to the replacement", "Test locking, lights and start"],
      cautions: [],
      more: ["Module part number"],
    }),
  },
  {
    id: "service",
    test: /\b(service (light|reset|indicator)|assyst|sbc|parking brake|epb|hybrid battery|oil service)\b/,
    build: ({ mercedes }) => ({
      label: "service functions",
      causes: [],
      tools: mercedes
        ? [T(AB, "Service functions: ASSYST reset, SBC counter, electronic parking brake", "Mercedes service resets"),
          T(AB, "Hybrid batteries: reset and unlock", "Mild and plug-in hybrid battery functions")]
        : [T(DIAG, "Service reset and parking brake functions on the scan tool", "Standard service functions")],
      steps: ["Carry out the service work", "Run the reset or service function", "Check for warning lights"],
      cautions: [],
      more: [],
    }),
  },
];

const DEFAULT_PIECE: Piece = {
  label: "general fault",
  causes: ["Not enough detail yet to narrow it down"],
  tools: [T(DIAG, "Full-system fault code scan and live data", "Start with the facts from the car")],
  steps: ["Scan all modules and save the report", "Check battery and charging", "Reproduce the fault and note when it happens", "Add the codes and findings to the job notes and ask again"],
  cautions: [],
  more: ["Fault codes", "Symptoms and when they happen", "Any recent work on the car"],
};

/** Every fixed string a rules suggestion can contain (for translation coverage tests). */
export function RULE_STRINGS(): Set<string> {
  const out = new Set<string>();
  const add = (p: Piece) => {
    [p.label, ...p.causes, ...p.steps, ...p.cautions, ...p.more].forEach(x => out.add(x));
    p.tools.forEach(t => { out.add(t.function); out.add(t.why); });
  };
  for (const r of RULES) for (const mercedes of [true, false]) add(r.build({ mercedes }));
  add(DEFAULT_PIECE);
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs.map(x => x.trim()).filter(Boolean))];

/** Which rules match, by id (exported for tests). */
export function matchRules(input: RulesInput): string[] {
  const text = `${input.title}\n${input.description || ""}\n${(input.notes || []).join("\n")}`.toLowerCase();
  const ids = RULES.filter(r => r.test.test(text)).map(r => r.id);
  // "all keys lost" is the more specific key rule.
  return ids.includes("akl") ? ids.filter(id => id !== "keys") : ids;
}

/** Translates the fixed rule text into Polish (unknown strings, e.g. tool names, stay as they are). */
function localisePl(s: Suggestion): Suggestion {
  const tr = (x: string) => RULES_PL[x] ?? x;
  return {
    ...s,
    likely_causes: s.likely_causes.map(tr),
    recommended_tools: s.recommended_tools.map(t => ({ ...t, function: tr(t.function), why: tr(t.why) })),
    steps: s.steps.map(tr),
    cautions: s.cautions.map(tr),
    needs_more_info: s.needs_more_info.map(tr),
  };
}

export function rulesSuggestion(input: RulesInput, lang: Lang = "en"): Suggestion {
  const pl = lang === "pl";
  const mercedes = /mercedes|\bamg\b|\bsmart\b/i.test(input.make || "");
  const ctx: Ctx = { mercedes };
  const ids = matchRules(input).slice(0, 3);
  const pieces = ids.length ? ids.map(id => RULES.find(r => r.id === id)!.build(ctx)) : [DEFAULT_PIECE];

  const soon = comingSoonFor(input.make);
  const moduleWork = ids.some(id => ["akl", "keys", "eis", "cluster", "ecu", "coding", "gearbox"].includes(id));
  const cautions = pieces.flatMap(p => p.cautions);
  const more = pieces.flatMap(p => p.more);
  if (soon && moduleWork) {
    cautions.unshift(pl
      ? `${soon.name} nie jest jeszcze dostępny, więc prace na poziomie ASO przy tej marce mogą poczekać na licencję albo trzeba je zlecić innemu specjaliście.`
      : `${soon.name} isn't available yet, so dealer-level work on this make may need to wait for the licence or be referred to another specialist.`);
    more.push("Check whether the job can be done with the tools available now before booking it in");
  }

  const car = [input.make, input.model].filter(Boolean).join(" ");
  const labels = pieces.map(p => (pl ? RULES_PL[p.label] ?? p.label : p.label));
  const summary = pl
    ? ids.length
      ? `Wygląda na: ${labels.join(", ")}${car ? ` (${car})` : ""}. To punkt wyjścia z reguł warsztatu; sprawdź auto, zanim coś zrobisz.`
      : `Za mało szczegółów, żeby dopasować znany rodzaj pracy${car ? ` (${car})` : ""}. Zacznij od pełnego skanu i dopisz ustalenia do notatek.`
    : ids.length
      ? `Looks like ${labels.join(", ")} work${car ? ` on a ${car}` : ""}. A starting point from the workshop's rules; check the car before acting.`
      : `Not enough detail to match a known job type${car ? ` for this ${car}` : ""}. Start with a full scan and add what you find to the notes.`;

  const raw: Suggestion = {
    summary,
    likely_causes: uniq(pieces.flatMap(p => p.causes)),
    recommended_tools: pieces.flatMap(p => p.tools),
    steps: uniq(pieces.flatMap(p => p.steps)),
    cautions: uniq(cautions),
    confidence: ids.length && input.make ? "medium" : "low",
    needs_more_info: uniq(more),
  };
  // Same checks as AI output: unknown tools dropped, backup reminder guaranteed.
  const clean = sanitiseSuggestion(raw, { make: input.make }) ?? raw;
  return pl ? localisePl(clean) : clean;
}
