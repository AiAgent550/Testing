// Pure helpers for tidying the upper-case names DVLA and DVSA return ("MERCEDES-BENZ" -> "Mercedes-Benz").

const KEEP_UPPER = new Set(["BMW", "MG", "DS", "BYD", "LEVC", "MINI", "SEAT", "AMG", "GT", "GTI", "GTD", "TDI", "TSI", "TFSI", "CDI", "SUV", "RS", "ST", "LDV", "VW", "UK"]);
const SPECIAL: Record<string, string> = { KIA: "Kia", "ALFA": "Alfa", "LAND": "Land" };

function tidyToken(t: string): string {
  if (!t) return t;
  if (SPECIAL[t]) return SPECIAL[t];
  if (KEEP_UPPER.has(t)) return t;
  if (/^\d/.test(t)) return t.toLowerCase();               // 320D -> 320d, 2.0 stays
  if (/\d/.test(t)) return t;                              // A4, X5, C220 stay as written
  if (t.length <= 2) return t;                             // C, E, GT-like codes
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/** Title-cases an upper-case make or model while keeping badges and codes intact. */
export function tidyName(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s; // already mixed case: trust it
  return s.split(/(\s+|-|\/)/).map(part => (/^(\s+|-|\/)$/.test(part) ? part : tidyToken(part))).join("");
}

/** "GREY" -> "Grey". */
export function tidyColour(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  return s ? s.replace(/(^|\s|-)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : null;
}
