// Rule-based lead spotting, used when AI isn't connected (or fails). Also used before AI as a
// cheap filter: emoji-only, spam and insults are never leads and never cost an AI call.
import type { Service } from "../../lib/types";

export interface Triage {
  is_lead: boolean;
  score: number;                 // 0-100
  summary: string;
  service: Service | null;
  make: string | null;
  model: string | null;
  urgency: "low" | "normal" | "high";
  suggested_reply: string;
}

const SPAM = /\b(scam+(er|mers?)?|follow (me|back)|check (out )?my (page|profile|bio)|dm (me )?for (promo|collab|shoutout)|promo(tion)? (on|at)|crypto|bitcoin|forex|giveaway|onlyfans|earn \$|make money|whatsapp me on|\+?\d{11,})\b|https?:\/\/|www\./i;
const INSULT = /\b(shit|crap|rubbish|idiots?|clowns?|cowboys?|rip[- ]?off|fake|joke|wankers?|muppets?|useless|trash|garbage|f+u+c+k\w*|bollocks)\b/i;

/** Emoji-only, punctuation-only, a couple of letters, spam or an insult. */
export function isNoise(text: string): boolean {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 4) return true;
  if (SPAM.test(text)) return true;
  if (INSULT.test(text) && !/\b(can|could|do|how much|price)\b/i.test(text)) return true;
  return false;
}

const SERVICE_RULES: [Service, RegExp, number][] = [
  ["keys", /\b(keys?|fob|spare key|lost (both |all |my )?keys?|key programming|immobili[sz]er|transponder|locked out)\b/i, 30],
  ["remap", /\b(remap|re-map|stage ?[123]|tun(e|ing)|bhp|dpf|egr|adblue|pops? (and|&|n) bangs)\b/i, 30],
  ["coding", /\b(cod(e|ing)|retrofit|carplay|android auto|activate|unlock feature|ambient lights?|vediamo|xentry|dealer level)\b/i, 25],
  ["modules", /\b(modules?|clon(e|ing)|ecu|tcu|gearbox (ecu|module)|cluster|airbag module|ezs|eis|esl)\b/i, 25],
  ["diagnostics", /\b(diagnos\w*|warning lights?|engine light|eml|fault|limp mode|error codes?|check engine|won'?t start|no start)\b/i, 25],
  ["servicing", /\b(servic(e|ing)|brakes?|pads|discs|oil change|repairs?|mot|clutch|suspension)\b/i, 20],
];

const ENQUIRY = /\b(can you|could you|do you|are you able|would you|is it possible|any chance|you able|can u|do u)\b/i;
const PRICE = /(how much|price|pricing|cost|quote|£|\bcharge\b|\brates?\b)/i;
const AVAILABILITY = /\b(available|availability|when can|this week|next week|tomorrow|today|appointment|book(ing)?( in)?|slot|asap|urgent(ly)?)\b/i;
const LOCATION = /\b(leeds|bradford|wakefield|huddersfield|halifax|york|sheffield|manchester|near(by| me)?|area|mobile|come to|travel|postcode|cover)\b/i;
const URGENT = /\b(lost (both|all) keys|no keys|locked out|stranded|asap|urgent(ly)?|today|won'?t start|no start|limp mode|broken down)\b/i;

const MAKES: [string, RegExp][] = [
  ["Mercedes-Benz", /\b(mercedes|merc|benz|amg)\b/i],
  ["BMW", /\bbmw\b/i],
  ["Audi", /\baudi\b/i],
  ["Volkswagen", /\b(vw|volkswagen|golf|polo|passat|tiguan|transporter|scirocco|arteon|t-?roc)\b/i],
  ["Ford", /\b(ford|fiesta|focus|transit|ranger|kuga|mustang)\b/i],
  ["Vauxhall", /\b(vauxhall|corsa|astra|insignia)\b/i],
  ["SEAT", /\b(seat (leon|ibiza|ateca|arona)|cupra)\b/i],
  ["Skoda", /\b(skoda|octavia|fabia|superb|kodiaq)\b/i],
  ["Land Rover", /\b(land rover|range rover|discovery|defender|evoque)\b/i],
  ["Toyota", /\btoyota\b/i], ["Nissan", /\bnissan\b/i], ["Honda", /\bhonda\b/i], ["Kia", /\bkia\b/i],
  ["Hyundai", /\bhyundai\b/i], ["Porsche", /\bporsche\b/i], ["Volvo", /\bvolvo\b/i], ["Jaguar", /\bjaguar\b/i],
  ["Peugeot", /\bpeugeot\b/i], ["Citroen", /\bcitro[eë]n\b/i], ["Renault", /\brenault\b/i], ["Fiat", /\bfiat\b/i],
  ["MINI", /\bmini\b/i], ["Tesla", /\btesla\b/i], ["Lexus", /\blexus\b/i], ["Mazda", /\bmazda\b/i],
];

// Single letters need the number attached ("C220", "a45") so "a 20 minute job" isn't read as a model.
const MERC_MODEL = /\b(?:(CLA|CLS|CLK|GLA|GLB|GLC|GLE|GLS|ML|SLK|SLC|SL)\s?-?|([ABCEGSV]))(\d{2,3})\b/i;
const AUDI_MODEL = /\b(RS ?\d|S\d|A\d|Q\d|TT ?RS|TTS|TT)\b/i;
const BMW_MODEL = /\b([1-8]\d{2}[dei]|M[2-8]|X[1-7]|[1-8] series)\b/i;
const VW_MODEL = /\b(golf( r| gti| gtd)?|polo( gti)?|passat|tiguan|transporter|t-?roc|arteon|scirocco)\b/i;

export function detectVehicle(text: string): { make: string | null; model: string | null } {
  const merc = text.match(MERC_MODEL);
  if (merc) return { make: "Mercedes-Benz", model: `${(merc[1] || merc[2]).toUpperCase()}${merc[3]}` };
  const bmw = text.match(BMW_MODEL);
  if (bmw && /bmw|series|\b[1-8]\d{2}[dei]\b|\bM[2-8]\b/i.test(text)) return { make: "BMW", model: bmw[1].replace(/series/i, "Series") };
  const vw = text.match(VW_MODEL);
  if (vw) return { make: "Volkswagen", model: vw[1].replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(Gti|Gtd)\b/, s => s.toUpperCase()) };
  const audi = text.match(AUDI_MODEL);
  if (audi && (/audi/i.test(text) || /^(RS|S)/i.test(audi[1]))) return { make: "Audi", model: audi[1].toUpperCase().replace(/\s/g, "") };
  for (const [make, re] of MAKES) if (re.test(text)) return { make, model: null };
  if (audi) return { make: "Audi", model: audi[1].toUpperCase().replace(/\s/g, "") };
  return { make: null, model: null };
}

const SERVICE_WORDS: Record<Service, string> = {
  remap: "a remap", keys: "keys", coding: "coding", modules: "module work",
  diagnostics: "diagnostics", servicing: "servicing and repairs", other: "that",
};

export function templateReply(handle: string | null, service: Service | null, vehicle?: string | null): string {
  const hi = handle ? `Hi @${handle.replace(/^@/, "")}` : "Hi";
  const what = service && service !== "other" ? `${SERVICE_WORDS[service]}${vehicle ? ` on the ${vehicle}` : ""}` : "that";
  return `${hi}, thanks for getting in touch! We can help with ${what}. Send us your reg and book in through our website, or give us a call, and we'll take it from there.`;
}

/** Scores a public comment 0-100 for "a real person asking about a job, price or availability". */
export function heuristicTriage(text: string, handle: string | null = null): Triage {
  const clean = text.trim();
  if (isNoise(clean)) {
    return { is_lead: false, score: 0, summary: "Not an enquiry (emoji, spam or abuse).", service: null, make: null, model: null, urgency: "low", suggested_reply: "" };
  }
  let score = 0;
  let service: Service | null = null, best = 0;
  for (const [s, re, pts] of SERVICE_RULES) {
    if (re.test(clean)) { score += best ? 5 : pts; if (pts > best) { best = pts; service = s; } }
  }
  const enquiry = ENQUIRY.test(clean), price = PRICE.test(clean);
  if (price) score += 30;
  if (enquiry) score += 20;
  if (/\?/.test(clean)) score += 10;
  if (AVAILABILITY.test(clean)) score += 10;
  if (LOCATION.test(clean)) score += 10;
  const vehicle = detectVehicle(clean);
  if (vehicle.make) score += 15;
  if (/\b(19[89]\d|20[0-3]\d)\b|\b\d{2} plate\b/i.test(clean)) score += 5;
  if (/\bmy\b/i.test(clean)) score += 5;
  // Without a question, a price ask or a service, it's chat ("nice car", "love this").
  if (!service && !price && !enquiry) score = Math.min(score, 20);
  if (!service && score >= 50) service = "other";
  score = Math.max(0, Math.min(100, score));
  const isLead = score >= 50;
  const vehicleText = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null;
  const summary = isLead
    ? `Asking about ${service && service !== "other" ? SERVICE_WORDS[service] : "work"}${vehicleText ? ` on a ${vehicleText}` : ""}${price ? " (wants a price)" : ""}.`
    : "General comment, not an enquiry.";
  return {
    is_lead: isLead, score, summary, service: isLead ? service : null, make: vehicle.make, model: vehicle.model,
    urgency: URGENT.test(clean) ? "high" : isLead ? "normal" : "low",
    suggested_reply: isLead ? templateReply(handle, service, vehicle.model || vehicle.make) : "",
  };
}
