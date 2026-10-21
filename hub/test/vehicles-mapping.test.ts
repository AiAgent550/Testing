import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../src/lib/env";
import { fetchDvla, mapDvla } from "../src/modules/vehicles/dvla";
import { fetchDvsa, kmToMiles, mapDvsa, odometerMiles, resetDvsaToken } from "../src/modules/vehicles/dvsa";
import { DVLA_FIXTURES, DVSA_FIXTURES } from "../src/modules/vehicles/fixtures";
import { mergeLookup } from "../src/modules/vehicles/merge";
import { tidyColour, tidyName } from "../src/modules/vehicles/names";
import { isStale } from "../src/modules/vehicles/service";

// Shaped like the DVLA Vehicle Enquiry Service documentation example.
const DVLA_SAMPLE = {
  registrationNumber: "WN67DSO", taxStatus: "Taxed", taxDueDate: "2027-12-01", motStatus: "Valid", motExpiryDate: "2027-11-30",
  make: "MERCEDES-BENZ", yearOfManufacture: 2019, engineCapacity: 1950, co2Emissions: 128, fuelType: "DIESEL", markedForExport: false,
  colour: "GREY", typeApproval: "M1", dateOfLastV5CIssued: "2023-05-01", wheelplan: "2 AXLE RIGID BODY", monthOfFirstRegistration: "2019-03",
};

// Shaped like a DVSA MOT history response, tests deliberately out of order.
const DVSA_SAMPLE = {
  registration: "WN67DSO", make: "MERCEDES-BENZ", model: "C-CLASS", firstUsedDate: "2019-03-01", fuelType: "Diesel", primaryColour: "Grey",
  registrationDate: "2019-03-01", manufactureDate: "2019-02-11", engineSize: "1950", hasOutstandingRecall: "No",
  motTests: [
    { completedDate: "2024-03-01T10:00:00.000Z", testResult: "PASSED", expiryDate: "2025-03-02", odometerValue: "38000", odometerUnit: "MI", odometerResultType: "READ" },
    { completedDate: "2026-02-27T10:00:00.000Z", testResult: "PASSED", expiryDate: "2027-03-02", odometerValue: "100000", odometerUnit: "KM", odometerResultType: "READ" },
    { completedDate: "2025-02-28T10:00:00.000Z", testResult: "FAILED", odometerValue: "45000", odometerUnit: "MI", odometerResultType: "READ" },
  ],
};

const env = (vars: Partial<Env> = {}) => ({ APP_ORIGIN: "https://hub.example", SITE_ORIGIN: "https://site.example", ...vars }) as Env;
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("DVLA mapping", () => {
  it("maps the documented fields", () => {
    expect(mapDvla(DVLA_SAMPLE)).toEqual({
      make: "Mercedes-Benz", colour: "Grey", fuel_type: "Diesel", year: 2019, engine_cc: 1950,
      mot_status: "Valid", mot_expiry: "2027-11-30", tax_status: "Taxed", tax_due: "2027-12-01",
    });
  });
  it("copes with missing fields", () => {
    expect(mapDvla({ registrationNumber: "AB12CDE", monthOfFirstRegistration: "2004-12" })).toMatchObject({ make: null, year: 2004, engine_cc: null });
  });
});

describe("DVSA mapping", () => {
  it("takes the model and the newest test's mileage, converting kilometres", () => {
    const m = mapDvsa(DVSA_SAMPLE);
    expect(m.model).toBe("C-Class");
    expect(m.last_mileage).toBe(62137);
    expect(m.last_test_date).toBe("2026-02-27T10:00:00.000Z");
    expect(m.mot_expiry).toBe("2027-03-02");
    expect(m.year).toBe(2019);
    expect(m.engine_cc).toBe(1950);
  });
  it("converts km to miles", () => {
    expect(kmToMiles(100)).toBe(62);
    expect(kmToMiles(150000)).toBe(93206);
    expect(odometerMiles("150000", "KM")).toBe(93206);
    expect(odometerMiles("150000", "km")).toBe(93206);
    expect(odometerMiles("41000", "MI")).toBe(41000);
    expect(odometerMiles("", "MI")).toBeNull();
    expect(odometerMiles(null, null)).toBeNull();
  });
  it("handles a car with no MOTs yet", () => {
    expect(mapDvsa({ make: "BMW", model: "320D" })).toMatchObject({ make: "BMW", model: "320d", last_mileage: null, last_test_date: null });
  });
});

describe("merged lookup", () => {
  it("prefers DVLA for make and status and DVSA for model and mileage", () => {
    const l = mergeLookup("WN67DSO",
      { status: "ok", fields: mapDvla(DVLA_SAMPLE), raw: DVLA_SAMPLE },
      { status: "ok", fields: mapDvsa(DVSA_SAMPLE), raw: DVSA_SAMPLE });
    expect(l).toMatchObject({ found: true, make: "Mercedes-Benz", model: "C-Class", colour: "Grey", year: 2019, last_mileage: 62137, mot_expiry: "2027-11-30", sources: { dvla: "ok", dvsa: "ok" } });
  });
  it("reports not found and not configured sources honestly", () => {
    const l = mergeLookup("ZZ99ZZZ", { status: "not_found", fields: null, raw: null }, { status: "not_configured", fields: null, raw: null });
    expect(l.found).toBe(false);
    expect(l.make).toBeNull();
    expect(l.sources).toEqual({ dvla: "not_found", dvsa: "not_configured" });
  });
  it("development fixtures map to sensible cars", () => {
    const amg = mergeLookup("MK20AMG", { status: "ok", fields: mapDvla(DVLA_FIXTURES.MK20AMG), raw: null }, { status: "ok", fields: mapDvsa(DVSA_FIXTURES.MK20AMG), raw: null });
    expect([amg.make, amg.model, amg.year]).toEqual(["Mercedes-Benz", "AMG GT", 2020]);
    const golf = mapDvsa(DVSA_FIXTURES.WR70XYZ);
    expect([golf.model, golf.last_mileage]).toEqual(["Golf", 61240]);
    expect(mapDvsa(DVSA_FIXTURES.BM19EEE).last_mileage).toBe(93206);
  });
});

describe("names", () => {
  it("tidies upper-case makes and models", () => {
    expect(tidyName("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(tidyName("VOLKSWAGEN")).toBe("Volkswagen");
    expect(tidyName("BMW")).toBe("BMW");
    expect(tidyName("LAND ROVER")).toBe("Land Rover");
    expect(tidyName("A4 AVANT")).toBe("A4 Avant");
    expect(tidyName("Golf")).toBe("Golf");
    expect(tidyName("")).toBeNull();
    expect(tidyColour("DARK GREY")).toBe("Dark Grey");
  });
});

describe("API calls never throw", () => {
  afterEach(() => resetDvsaToken());

  it("DVLA: not configured, ok, 404 and 500", async () => {
    expect((await fetchDvla(env(), "AB12CDE")).status).toBe("not_configured");
    let sent: RequestInit | undefined;
    const ok = await fetchDvla(env({ DVLA_API_KEY: "k" }), "WN67DSO", (async (_u: unknown, init?: RequestInit) => { sent = init; return jsonRes(200, DVLA_SAMPLE); }) as typeof fetch);
    expect(ok.status).toBe("ok");
    expect(ok.fields?.make).toBe("Mercedes-Benz");
    expect((sent?.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(String(sent?.body))).toEqual({ registrationNumber: "WN67DSO" });
    expect((await fetchDvla(env({ DVLA_API_KEY: "k" }), "X", (async () => jsonRes(404, {})) as typeof fetch)).status).toBe("not_found");
    expect((await fetchDvla(env({ DVLA_API_KEY: "k" }), "X", (async () => jsonRes(500, {})) as typeof fetch)).status).toBe("error");
    expect((await fetchDvla(env({ DVLA_API_KEY: "k" }), "X", (async () => { throw new Error("offline"); }) as typeof fetch)).status).toBe("error");
  });

  it("DVSA: token is fetched once and reused", async () => {
    const e = env({ DVSA_CLIENT_ID: "id", DVSA_CLIENT_SECRET: "s", DVSA_API_KEY: "k", DVSA_TOKEN_URL: "https://login.example/token", DVSA_SCOPE: "https://tapi.dvsa.gov.uk/.default" });
    let tokenCalls = 0;
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      if (u.includes("login.example")) { tokenCalls++; return jsonRes(200, { access_token: "tok", expires_in: 3599 }); }
      calls.push({ url: u, headers: init?.headers as Record<string, string> });
      return u.endsWith("NOPE") ? jsonRes(404, {}) : jsonRes(200, DVSA_SAMPLE);
    }) as typeof fetch;
    const a = await fetchDvsa(e, "WN67DSO", f);
    const b = await fetchDvsa(e, "NOPE", f);
    expect(a.status).toBe("ok");
    expect(a.fields?.last_mileage).toBe(62137);
    expect(b.status).toBe("not_found");
    expect(tokenCalls).toBe(1);
    expect(calls[0].url).toBe("https://history.mot.api.gov.uk/v1/trade/vehicles/registration/WN67DSO");
    expect(calls[0].headers.authorization).toBe("Bearer tok");
    expect(calls[0].headers["x-api-key"]).toBe("k");
    expect((await fetchDvsa(env(), "WN67DSO", f)).status).toBe("not_configured");
    expect((await fetchDvsa(e, "WN67DSO", (async () => { throw new Error("offline"); }) as typeof fetch)).status).toBe("error");
  });
});

describe("staleness", () => {
  it("refreshes data that was never fetched or is over 30 days old", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-09-01T12:00:00Z", now)).toBe(true);
    expect(isStale("2026-10-01T12:00:00Z", now)).toBe(false);
  });
});
