// DVLA Vehicle Enquiry Service: tax and MOT status, make, colour, year, engine size.
// POST https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles
// header x-api-key, body {"registrationNumber": "AB12CDE"}; 404 means DVLA holds no record.
import type { Env } from "../../lib/env";
import { tidyColour, tidyName } from "./names";

export const DVLA_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

/** Fields of the DVLA response we use (others are kept in the raw JSON). */
export interface DvlaResponse {
  registrationNumber?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  make?: string;
  yearOfManufacture?: number;
  monthOfFirstRegistration?: string;
  engineCapacity?: number;
  fuelType?: string;
  colour?: string;
  [k: string]: unknown;
}

export interface DvlaFields {
  make: string | null; colour: string | null; fuel_type: string | null; year: number | null; engine_cc: number | null;
  mot_status: string | null; mot_expiry: string | null; tax_status: string | null; tax_due: string | null;
}

export type SourceStatus = "ok" | "not_found" | "not_configured" | "error";
export interface SourceResult<T> { status: SourceStatus; fields: T | null; raw: unknown }

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function mapDvla(r: DvlaResponse): DvlaFields {
  return {
    make: tidyName(strOrNull(r.make)),
    colour: tidyColour(strOrNull(r.colour)),
    fuel_type: tidyColour(strOrNull(r.fuelType)),
    year: numOrNull(r.yearOfManufacture) ?? numOrNull(strOrNull(r.monthOfFirstRegistration)?.slice(0, 4)),
    engine_cc: numOrNull(r.engineCapacity),
    mot_status: strOrNull(r.motStatus),
    mot_expiry: strOrNull(r.motExpiryDate),
    tax_status: strOrNull(r.taxStatus),
    tax_due: strOrNull(r.taxDueDate),
  };
}

/** Never throws: network problems and 5xx come back as status "error". */
export async function fetchDvla(env: Env, reg: string, fetchFn: typeof fetch = fetch): Promise<SourceResult<DvlaFields>> {
  if (!env.DVLA_API_KEY) return { status: "not_configured", fields: null, raw: null };
  try {
    const res = await fetchFn(DVLA_URL, {
      method: "POST",
      headers: { "x-api-key": env.DVLA_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ registrationNumber: reg }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { status: "not_found", fields: null, raw: null };
    if (!res.ok) {
      console.warn("DVLA lookup failed", res.status);
      return { status: "error", fields: null, raw: null };
    }
    const raw = (await res.json()) as DvlaResponse;
    return { status: "ok", fields: mapDvla(raw), raw };
  } catch (err) {
    console.warn("DVLA lookup error", err);
    return { status: "error", fields: null, raw: null };
  }
}
