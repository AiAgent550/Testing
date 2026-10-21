// DVSA MOT History API: model, colour and the mileage recorded at each MOT.
// OAuth2 client credentials (token cached in memory until it expires), then
// GET https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{reg}
// with Authorization: Bearer <token> and X-API-Key. 404 means no record.
import type { Env } from "../../lib/env";
import type { SourceResult } from "./dvla";
import { tidyColour, tidyName } from "./names";

export const DVSA_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration/";

export interface DvsaMotTest {
  completedDate?: string;
  testResult?: string;
  expiryDate?: string;
  odometerValue?: string | number;
  odometerUnit?: string;
  odometerResultType?: string;
  motTestNumber?: string;
  [k: string]: unknown;
}

export interface DvsaResponse {
  registration?: string;
  make?: string;
  model?: string;
  fuelType?: string;
  primaryColour?: string;
  firstUsedDate?: string;
  manufactureDate?: string;
  engineSize?: string | number;
  motTests?: DvsaMotTest[];
  [k: string]: unknown;
}

export interface DvsaFields {
  make: string | null; model: string | null; colour: string | null; fuel_type: string | null;
  year: number | null; engine_cc: number | null; last_mileage: number | null;
  last_test_date: string | null; last_test_result: string | null; mot_expiry: string | null;
}

const MILES_PER_KM = 0.621371;
export const kmToMiles = (km: number) => Math.round(km * MILES_PER_KM);

/** Reads an odometer reading as miles; null when there's no usable reading. */
export function odometerMiles(value: unknown, unit: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return String(unit || "").toLowerCase() === "km" ? kmToMiles(n) : Math.round(n);
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const yearOf = (d: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
/** DVSA dates come as "2023-05-12T10:11:12.000Z" or "2023.05.12 10:11:12" depending on age. */
const dateKey = (d: unknown) => (typeof d === "string" ? d.replace(/\./g, "-") : "");

/** Tests sorted newest first. */
export function sortedTests(r: DvsaResponse): DvsaMotTest[] {
  return [...(Array.isArray(r.motTests) ? r.motTests : [])].sort((a, b) => dateKey(b.completedDate).localeCompare(dateKey(a.completedDate)));
}

export function mapDvsa(r: DvsaResponse): DvsaFields {
  const tests = sortedTests(r);
  const newest = tests[0];
  const withMiles = tests.find(t => odometerMiles(t.odometerValue, t.odometerUnit) !== null);
  const passed = tests.find(t => strOrNull(t.expiryDate));
  const engine = typeof r.engineSize === "string" ? Number(r.engineSize) : r.engineSize;
  return {
    make: tidyName(strOrNull(r.make)),
    model: tidyName(strOrNull(r.model)),
    colour: tidyColour(strOrNull(r.primaryColour)),
    fuel_type: tidyColour(strOrNull(r.fuelType)),
    year: yearOf(strOrNull(r.manufactureDate)) ?? yearOf(strOrNull(r.firstUsedDate)),
    engine_cc: typeof engine === "number" && Number.isFinite(engine) && engine > 0 ? engine : null,
    last_mileage: withMiles ? odometerMiles(withMiles.odometerValue, withMiles.odometerUnit) : null,
    last_test_date: newest ? strOrNull(newest.completedDate) : null,
    last_test_result: newest ? strOrNull(newest.testResult) : null,
    mot_expiry: passed ? strOrNull(passed.expiryDate)?.replace(/\./g, "-").slice(0, 10) ?? null : null,
  };
}

// ---------- OAuth token, cached for this isolate ----------
let cached: { token: string; expiresAt: number; clientId: string } | null = null;

export function resetDvsaToken() { cached = null; }

async function token(env: Env, fetchFn: typeof fetch): Promise<string> {
  if (cached && cached.clientId === env.DVSA_CLIENT_ID && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetchFn(env.DVSA_TOKEN_URL!, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.DVSA_CLIENT_ID!,
      client_secret: env.DVSA_CLIENT_SECRET!,
      scope: env.DVSA_SCOPE!,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DVSA token request failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("DVSA token response had no access_token");
  cached = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000, clientId: env.DVSA_CLIENT_ID! };
  return cached.token;
}

export const dvsaConfigured = (env: Env) =>
  !!(env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_API_KEY && env.DVSA_TOKEN_URL && env.DVSA_SCOPE);

/** Never throws: network problems and 5xx come back as status "error". */
export async function fetchDvsa(env: Env, reg: string, fetchFn: typeof fetch = fetch): Promise<SourceResult<DvsaFields>> {
  if (!dvsaConfigured(env)) return { status: "not_configured", fields: null, raw: null };
  try {
    const call = async () => fetchFn(DVSA_URL + encodeURIComponent(reg), {
      headers: { authorization: `Bearer ${await token(env, fetchFn)}`, "x-api-key": env.DVSA_API_KEY!, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    let res = await call();
    if (res.status === 401) { cached = null; res = await call(); } // token revoked or expired early
    if (res.status === 404) return { status: "not_found", fields: null, raw: null };
    if (!res.ok) {
      console.warn("DVSA lookup failed", res.status);
      return { status: "error", fields: null, raw: null };
    }
    const raw = (await res.json()) as DvsaResponse;
    return { status: "ok", fields: mapDvsa(raw), raw };
  } catch (err) {
    console.warn("DVSA lookup error", err);
    return { status: "error", fields: null, raw: null };
  }
}
