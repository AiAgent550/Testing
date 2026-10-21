// Contract other modules use. Implemented in stage 2.
import type { Env } from "../../lib/env";
import type { VehicleRow } from "../../lib/types";

export interface VehicleLookup {
  reg: string;
  found: boolean;
  make: string | null; model: string | null; colour: string | null; fuel_type: string | null;
  year: number | null; engine_cc: number | null; mot_status: string | null; mot_expiry: string | null;
  tax_status: string | null; tax_due: string | null; last_mileage: number | null;
  sources: { dvla: "ok" | "not_found" | "not_configured" | "error"; dvsa: "ok" | "not_found" | "not_configured" | "error" };
}

/** Looks a registration up with DVLA (tax, MOT status, make, year) and DVSA (model, mileage history). */
export async function lookupVehicle(_env: Env, _reg: string): Promise<VehicleLookup> {
  throw new Error("vehicles.lookupVehicle not implemented yet");
}

/** Returns the stored vehicle for a registration, creating it (and refreshing lookup data if stale). */
export async function ensureVehicle(_env: Env, _reg: string, _customerId: string | null, _actorId: string | null): Promise<VehicleRow> {
  throw new Error("vehicles.ensureVehicle not implemented yet");
}

/** Updates details captured at the car (VIN from the scan tool, current mileage). */
export async function updateVehicle(_env: Env, _id: string, _patch: { vin?: string | null; last_mileage?: number | null }, _actorId: string | null): Promise<VehicleRow> {
  throw new Error("vehicles.updateVehicle not implemented yet");
}

export async function getVehicle(_env: Env, _id: string): Promise<VehicleRow | null> {
  throw new Error("vehicles.getVehicle not implemented yet");
}
