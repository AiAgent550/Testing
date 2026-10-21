// Pure: combines the DVLA and DVSA answers into one VehicleLookup.
// DVLA is the authority for make, colour, year, tax and MOT status; DVSA adds the model and mileage.
import type { DvlaFields, SourceResult } from "./dvla";
import type { DvsaFields } from "./dvsa";
import type { VehicleLookup } from "./service";

export function mergeLookup(reg: string, dvla: SourceResult<DvlaFields>, dvsa: SourceResult<DvsaFields>): VehicleLookup {
  const a = dvla.fields, b = dvsa.fields;
  return {
    reg,
    found: dvla.status === "ok" || dvsa.status === "ok",
    make: a?.make ?? b?.make ?? null,
    model: b?.model ?? null,
    colour: a?.colour ?? b?.colour ?? null,
    fuel_type: a?.fuel_type ?? b?.fuel_type ?? null,
    year: a?.year ?? b?.year ?? null,
    engine_cc: a?.engine_cc ?? b?.engine_cc ?? null,
    mot_status: a?.mot_status ?? null,
    mot_expiry: a?.mot_expiry ?? b?.mot_expiry ?? null,
    tax_status: a?.tax_status ?? null,
    tax_due: a?.tax_due ?? null,
    last_mileage: b?.last_mileage ?? null,
    sources: { dvla: dvla.status, dvsa: dvsa.status },
  };
}

