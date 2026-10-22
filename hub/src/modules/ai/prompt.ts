// System prompt and user prompt for job tool suggestions. The prompt is built only from whitelisted
// vehicle and job fields; customer details are never passed in, and contact details typed into
// free text (descriptions, notes) are redacted before anything leaves the Hub.
import { comingSoonFor, knowledgeText } from "./knowledge";

export const SYSTEM_PROMPT = `You are the assistant to an experienced UK auto-electrical, diagnostics and ECU/key programming technician at Curve Performance, a small independent garage.
Given a vehicle and a job description, suggest likely causes, which of the garage's own tools and functions to use, and the steps to take.

Rules:
- Recommend ONLY tools listed as AVAILABLE in the workshop knowledge base, using their exact names. Never recommend a tool marked COMING SOON. If the job needs a licence or capability the garage does not have yet (for example VW Group or BMW key and module work on Abrites), say plainly that the job may need to wait until that licence arrives or be referred to another specialist.
- You are advisory only: the technician decides. Say so where it matters and flag anything that needs checking first.
- Always include backing up the original data (full read and saved file of ECU, EEPROM or module data) before any write, coding change or adaptation.
- Never suggest anything unlawful or unsafe for UK road use: no mileage reduction or odometer alteration (mileage calibration is only to set a replacement unit to the car's true recorded mileage), no immobiliser removal or bypass to enable theft, no DPF, EGR, AdBlue/SCR or catalyst delete or "off" solutions, no airbag or safety system defeats. If asked, decline that part briefly and suggest the lawful repair.
- If the information is thin, keep confidence low and list what more you need.
- Write in plain British English, concise, for a technician on a phone in the workshop. No markdown.`;

/** Extra instruction when the technician reads the Hub in Polish. Tool names stay exactly as listed. */
export const POLISH_INSTRUCTION = `
Language: the technician reads Polish. Write every text field (summary, causes, functions, reasons, steps, cautions, questions) in natural, correct Polish with proper diacritics, using standard Polish workshop terms (sterownik, kodowanie, programowanie kluczy, immobilizer, kopia zapasowa, przebieg, jazda próbna). Keep the tool names exactly as given in English, and keep part numbers, fault codes and abbreviations (ECU, TCU, EIS, ELV, FBS3, FBS4, OBD, VIN) unchanged.`;

export interface PromptVehicle {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  fuel_type?: string | null;
  engine_cc?: number | null;
  vin?: string | null;
}

export interface PromptInput {
  vehicle: PromptVehicle | null;
  job: { title: string; description?: string | null; mileage?: number | null };
  notes: string[];
}

/** Removes email addresses and phone numbers from free text. */
export function redactContacts(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+44\s?(?:\(0\)\s?)?|0044\s?|\b0)\d(?:[\s-]?\d){8,9}\b/g, "[phone removed]")
    .replace(/\+\d[\d\s-]{8,16}\d/g, "[phone removed]");
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "..." : s);

export function buildPrompt(input: PromptInput): string {
  const v = input.vehicle;
  const vehicleLines = v
    ? [
        `Make: ${v.make || "unknown"}`,
        `Model: ${v.model || "unknown"}`,
        `Year: ${v.year ?? "unknown"}`,
        `Fuel: ${v.fuel_type || "unknown"}`,
        `Engine: ${v.engine_cc ? `${v.engine_cc} cc` : "unknown"}`,
        `VIN: ${v.vin || "not recorded"}`,
      ]
    : ["No vehicle linked to this job."];
  if (input.job.mileage != null) vehicleLines.push(`Mileage: ${input.job.mileage}`);

  const soon = comingSoonFor(v?.make);
  const notes = input.notes.slice(-10).map(n => `- ${clip(redactContacts(n), 600)}`);

  return [
    "# Workshop knowledge base",
    knowledgeText(),
    "",
    "# Vehicle",
    ...vehicleLines,
    soon ? `Note: this make is covered by "${soon.name}", which is COMING SOON and not available yet.` : "",
    "",
    "# Job",
    `Title: ${redactContacts(input.job.title)}`,
    `Description: ${input.job.description ? clip(redactContacts(input.job.description), 3000) : "none given"}`,
    "",
    "# Latest technician notes",
    notes.length ? notes.join("\n") : "none yet",
    "",
    "Suggest likely causes, the garage's tools and functions to use, steps, cautions and what more information would help.",
  ].join("\n");
}
