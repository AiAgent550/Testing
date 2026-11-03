// Contract other modules use: registration lookups and the stored vehicle records.
import type { Env } from "../../lib/env";
import type { VehicleRow } from "../../lib/types";
import { audit } from "../../lib/audit";
import { first, newId, now, run, updateSet } from "../../lib/db";
import { badRequest, notFound } from "../../lib/http";
import { isLocal } from "../../lib/session";
import { normaliseReg } from "../../lib/validate";
import { fetchDvla, mapDvla, type DvlaFields, type SourceResult } from "./dvla";
import { fetchDvsa, mapDvsa, odometerMiles, sortedTests, type DvsaFields, type DvsaResponse } from "./dvsa";
import { DVLA_FIXTURES, DVSA_FIXTURES } from "./fixtures";
import { mergeLookup } from "./merge";

export interface VehicleLookup {
  reg: string;
  found: boolean;
  make: string | null; model: string | null; colour: string | null; fuel_type: string | null;
  year: number | null; engine_cc: number | null; mot_status: string | null; mot_expiry: string | null;
  tax_status: string | null; tax_due: string | null; last_mileage: number | null;
  sources: { dvla: "ok" | "not_found" | "not_configured" | "error"; dvsa: "ok" | "not_found" | "not_configured" | "error" };
}

/** Lookup data older than this is refreshed when the vehicle is next used. */
export const STALE_DAYS = 30;

interface FullLookup { lookup: VehicleLookup; dvlaRaw: unknown; dvsaRaw: unknown }

function validReg(input: string): string {
  const r = normaliseReg(input || "");
  if (r.length < 2 || r.length > 8) throw badRequest("Enter a valid registration.", { reg: "Enter a valid registration." });
  return r;
}

async function dvlaFor(env: Env, reg: string): Promise<SourceResult<DvlaFields>> {
  if (!env.DVLA_API_KEY && isLocal(env)) {
    const raw = DVLA_FIXTURES[reg];
    return raw ? { status: "ok", fields: mapDvla(raw), raw } : { status: "not_configured", fields: null, raw: null };
  }
  return fetchDvla(env, reg);
}

async function dvsaFor(env: Env, reg: string): Promise<SourceResult<DvsaFields>> {
  if (!env.DVSA_API_KEY && isLocal(env)) {
    const raw = DVSA_FIXTURES[reg];
    return raw ? { status: "ok", fields: mapDvsa(raw), raw } : { status: "not_configured", fields: null, raw: null };
  }
  return fetchDvsa(env, reg);
}

async function lookupFull(env: Env, reg: string): Promise<FullLookup> {
  const [dvla, dvsa] = await Promise.all([dvlaFor(env, reg), dvsaFor(env, reg)]);
  return { lookup: mergeLookup(reg, dvla, dvsa), dvlaRaw: dvla.raw, dvsaRaw: dvsa.raw };
}

/** Looks a registration up with DVLA (tax, MOT status, make, year) and DVSA (model, mileage history). Never throws for API trouble. */
export async function lookupVehicle(env: Env, reg: string): Promise<VehicleLookup> {
  return (await lookupFull(env, validReg(reg))).lookup;
}

/** True when the lookup gave a real answer (found or definitely not found), so it's worth remembering when we asked. */
const answered = (l: VehicleLookup) =>
  [l.sources.dvla, l.sources.dvsa].some(s => s === "ok" || s === "not_found");

/** Writes lookup data onto a stored vehicle. Only fills what the lookup knows; mileage only ever goes up. */
async function applyLookup(env: Env, id: string, full: FullLookup): Promise<void> {
  const l = full.lookup;
  if (!answered(l)) return;
  await run(
    env,
    `UPDATE vehicles SET
       make = COALESCE(?, make), model = COALESCE(?, model), colour = COALESCE(?, colour), fuel_type = COALESCE(?, fuel_type),
       year = COALESCE(?, year), engine_cc = COALESCE(?, engine_cc), mot_status = COALESCE(?, mot_status), mot_expiry = COALESCE(?, mot_expiry),
       tax_status = COALESCE(?, tax_status), tax_due = COALESCE(?, tax_due),
       last_mileage = CASE WHEN ? IS NOT NULL AND ? > COALESCE(last_mileage, 0) THEN ? ELSE last_mileage END,
       dvla_json = COALESCE(?, dvla_json), dvsa_json = COALESCE(?, dvsa_json), looked_up_at = ?, updated_at = ?
     WHERE id = ?`,
    l.make, l.model, l.colour, l.fuel_type, l.year, l.engine_cc, l.mot_status, l.mot_expiry, l.tax_status, l.tax_due,
    l.last_mileage, l.last_mileage, l.last_mileage,
    full.dvlaRaw ? JSON.stringify(full.dvlaRaw) : null, full.dvsaRaw ? JSON.stringify(full.dvsaRaw) : null, now(), now(), id,
  );
}

async function safeLookup(env: Env, reg: string): Promise<FullLookup | null> {
  try { return await lookupFull(env, reg); }
  catch (err) { console.warn("vehicle lookup failed", reg, err); return null; }
}

export const isStale = (lookedUpAt: string | null, nowMs = Date.now()) =>
  !lookedUpAt || Date.parse(lookedUpAt) < nowMs - STALE_DAYS * 864e5;

/** Returns the stored vehicle for a registration, creating it (and refreshing lookup data if stale). */
export async function ensureVehicle(env: Env, reg: string, customerId: string | null, actorId: string | null): Promise<VehicleRow> {
  const r = validReg(reg);
  let row = await first<VehicleRow>(env, "SELECT * FROM vehicles WHERE reg = ?", r);
  if (!row) {
    const id = newId("veh"), t = now();
    const inserted = await run(
      env,
      "INSERT INTO vehicles (id, reg, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(reg) DO NOTHING",
      id, r, customerId, t, t,
    );
    row = await first<VehicleRow>(env, "SELECT * FROM vehicles WHERE reg = ?", r);
    if (!row) throw new Error(`vehicle ${r} vanished after insert`);
    if (inserted.meta.changes) await audit(env, actorId, "vehicle.create", "vehicle", row.id, { reg: r });
  }
  if (customerId && !row.customer_id) {
    await run(env, "UPDATE vehicles SET customer_id = ?, updated_at = ? WHERE id = ?", customerId, now(), row.id);
    await audit(env, actorId, "vehicle.link_customer", "vehicle", row.id, { customer_id: customerId });
  }
  if (isStale(row.looked_up_at)) {
    const full = await safeLookup(env, r);
    if (full) {
      try { await applyLookup(env, row.id, full); }
      catch (err) { console.warn("saving vehicle lookup failed", r, err); }
    }
  }
  return (await first<VehicleRow>(env, "SELECT * FROM vehicles WHERE id = ?", row.id))!;
}

/** Fetches fresh DVLA/DVSA data for a stored vehicle regardless of age. */
export async function refreshVehicle(env: Env, id: string, actorId: string | null): Promise<{ vehicle: VehicleRow; lookup: VehicleLookup | null }> {
  const row = await getVehicle(env, id);
  if (!row) throw notFound("Vehicle");
  const full = await safeLookup(env, row.reg);
  if (full) {
    await applyLookup(env, id, full);
    await audit(env, actorId, "vehicle.refresh", "vehicle", id, { dvla: full.lookup.sources.dvla, dvsa: full.lookup.sources.dvsa });
  }
  return { vehicle: (await getVehicle(env, id))!, lookup: full?.lookup ?? null };
}

/** Updates details captured at the car (VIN from the scan tool, current mileage) and, from the dashboard, the owner. */
export async function updateVehicle(
  env: Env, id: string,
  patch: { vin?: string | null; last_mileage?: number | null; customer_id?: string | null },
  actorId: string | null,
): Promise<VehicleRow> {
  const row = await getVehicle(env, id);
  if (!row) throw notFound("Vehicle");
  const set = updateSet(patch, ["vin", "last_mileage", "customer_id"]);
  if (set.sql) {
    await run(env, `UPDATE vehicles SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, now(), id);
    await audit(env, actorId, "vehicle.update", "vehicle", id, patch as Record<string, unknown>);
  }
  return (await getVehicle(env, id))!;
}

export async function getVehicle(env: Env, id: string): Promise<VehicleRow | null> {
  return first<VehicleRow>(env, "SELECT * FROM vehicles WHERE id = ?", id);
}

/** A vehicle without the bulky raw API responses, plus a short MOT history taken from them. */
export function publicVehicle(v: VehicleRow) {
  const { dvla_json: _a, dvsa_json, ...rest } = v;
  let mot_tests: { date: string | null; result: string | null; mileage: number | null; expiry: string | null }[] = [];
  if (dvsa_json) {
    try {
      mot_tests = sortedTests(JSON.parse(dvsa_json) as DvsaResponse).slice(0, 6).map(t => ({
        date: t.completedDate ?? null, result: t.testResult ?? null, expiry: t.expiryDate ?? null,
        mileage: odometerMiles(t.odometerValue, t.odometerUnit),
      }));
    } catch { /* keep empty */ }
  }
  return { ...rest, mot_tests };
}

// ---------- correcting a registration on a job or booking ----------

export type RegChangeOutcome = "unchanged" | "cleared" | "relinked" | "corrected" | "created";

/**
 * Decides what a registration change means for the stored cars (pure, so every branch is unit-tested):
 * - the same plate: nothing to do;
 * - no plate: unlink the car;
 * - a plate another stored car already has: link to that car;
 * - a typo on a car nothing else uses: fix that car's plate in place;
 * - otherwise: a new car record, leaving the old one (used elsewhere) untouched.
 */
export function decideRegChange(input: {
  current: { id: string; reg: string } | null;
  newReg: string | null;
  existingWithNewReg: { id: string } | null;
  otherUses: number;
}): RegChangeOutcome {
  const { current, newReg, existingWithNewReg, otherUses } = input;
  if (!newReg) return current ? "cleared" : "unchanged";
  if (current && current.reg === newReg) return "unchanged";
  if (existingWithNewReg) return "relinked";
  if (current && otherUses === 0) return "corrected";
  return "created";
}

/** Swaps the old plate for the new one at the end of a title ("Keys and immobiliser · AB12 CDE"); other titles stay as typed. */
export function retitleForReg(title: string, oldReg: string | null, newReg: string | null): string {
  const fmt = (r: string) => (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r) ? `${r.slice(0, 4)} ${r.slice(4)}` : r);
  if (!oldReg) return title;
  const suffix = ` · ${fmt(oldReg)}`;
  if (!title.endsWith(suffix)) return title;
  const base = title.slice(0, -suffix.length);
  return newReg ? `${base} · ${fmt(newReg)}` : base;
}

/**
 * Applies a registration change for a group of records that share one car (a job and its booking).
 * Returns the car the group should now point at; the caller updates its own job/booking rows.
 */
export async function changeRegistration(
  env: Env,
  args: { currentVehicleId: string | null; newReg: string | null; jobIds: string[]; bookingIds: string[]; customerId: string | null },
  actorId: string | null,
): Promise<{ outcome: RegChangeOutcome; vehicleId: string | null; oldReg: string | null; newReg: string | null }> {
  const newReg = args.newReg ? validReg(args.newReg) : null;
  const current = args.currentVehicleId ? await getVehicle(env, args.currentVehicleId) : null;
  const existing = newReg ? await first<{ id: string }>(env, "SELECT id FROM vehicles WHERE reg = ?", newReg) : null;
  let otherUses = 0;
  if (current) {
    const notIn = (ids: string[]) => (ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(", ")})` : "");
    const jobs = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM jobs WHERE vehicle_id = ?${notIn(args.jobIds)}`, current.id, ...args.jobIds);
    const bookings = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM bookings WHERE vehicle_id = ?${notIn(args.bookingIds)}`, current.id, ...args.bookingIds);
    otherUses = (jobs?.n ?? 0) + (bookings?.n ?? 0);
  }
  const outcome = decideRegChange({ current: current && { id: current.id, reg: current.reg }, newReg, existingWithNewReg: existing && existing.id !== current?.id ? existing : null, otherUses });
  const oldReg = current?.reg ?? null;
  let vehicleId: string | null = current?.id ?? null;

  if (outcome === "cleared") vehicleId = null;
  else if (outcome === "relinked") vehicleId = existing!.id;
  else if (outcome === "corrected") {
    // Same car, wrong plate: keep VIN, mileage and owner, drop what was looked up for the wrong plate.
    await run(env,
      `UPDATE vehicles SET reg = ?, make = NULL, model = NULL, colour = NULL, fuel_type = NULL, year = NULL, engine_cc = NULL,
         mot_status = NULL, mot_expiry = NULL, tax_status = NULL, tax_due = NULL, dvla_json = NULL, dvsa_json = NULL,
         looked_up_at = NULL, updated_at = ? WHERE id = ?`,
      newReg, now(), current!.id);
    const full = await safeLookup(env, newReg!);
    if (full) {
      try { await applyLookup(env, current!.id, full); }
      catch (err) { console.warn("saving vehicle lookup failed", newReg, err); }
    }
  } else if (outcome === "created") {
    vehicleId = (await ensureVehicle(env, newReg!, args.customerId, actorId)).id;
  }
  if (outcome !== "unchanged") {
    await audit(env, actorId, "vehicle.reg_change", "vehicle", current?.id ?? vehicleId ?? undefined, {
      outcome, from: oldReg, to: newReg, vehicle_id: vehicleId, jobs: args.jobIds, bookings: args.bookingIds,
    });
  }
  return { outcome, vehicleId, oldReg, newReg };
}
