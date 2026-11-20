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

const VAG = new Set(["audi", "volkswagen", "vw", "seat", "skoda", "cupra"]);

/** "2.0 TDI", "2.2 diesel", "1.4 petrol", "Electric" - engine size from DVLA's cc plus a short fuel badge.
 *  VAG diesels are always badged TDI; other makes vary by model and year, so they just say the fuel. */
export function engineLabel(make: string | null | undefined, cc: number | null | undefined, fuel: string | null | undefined, model?: string | null): string | null {
  const f = String(fuel || "").toLowerCase();
  if (/electric/.test(f) && !/hybrid/.test(f)) return "Electric";
  const litres = cc && cc > 0 ? (Math.round(cc / 100) / 10).toFixed(1) : null;
  const badge = /diesel|heavy oil/.test(f) ? (VAG.has(String(make || "").toLowerCase()) ? "TDI" : "diesel")
    : /hybrid/.test(f) ? "hybrid" : /petrol/.test(f) ? "petrol" : f || null;
  // "A4 SE TDI" already says TDI, so the engine is just "2.0".
  const shown = badge && model && new RegExp(`\\b${badge}\\b`, "i").test(model) ? null : badge;
  return [litres, shown].filter(Boolean).join(" ") || null;
}
