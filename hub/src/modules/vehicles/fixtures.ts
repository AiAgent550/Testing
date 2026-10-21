// Deterministic DVLA and DVSA responses for LOCAL DEVELOPMENT ONLY (used when the keys are missing
// and the Hub runs on localhost), so the forms, tests and smoke checks work without real keys.
// Shapes follow the real APIs so the same mapping code runs on them.
import type { DvlaResponse } from "./dvla";
import type { DvsaResponse } from "./dvsa";

export const DVLA_FIXTURES: Record<string, DvlaResponse> = {
  MK20AMG: {
    registrationNumber: "MK20AMG", taxStatus: "Taxed", taxDueDate: "2027-03-01", motStatus: "Valid", motExpiryDate: "2027-02-14",
    make: "MERCEDES-BENZ", yearOfManufacture: 2020, monthOfFirstRegistration: "2020-03", engineCapacity: 3982, fuelType: "PETROL",
    colour: "GREY", co2Emissions: 284, markedForExport: false, typeApproval: "M1", wheelplan: "2 AXLE RIGID BODY", euroStatus: "EURO 6",
  },
  WR70XYZ: {
    registrationNumber: "WR70XYZ", taxStatus: "Taxed", taxDueDate: "2027-01-01", motStatus: "Valid", motExpiryDate: "2026-11-30",
    make: "VOLKSWAGEN", yearOfManufacture: 2020, monthOfFirstRegistration: "2020-09", engineCapacity: 1968, fuelType: "DIESEL",
    colour: "BLUE", co2Emissions: 118, markedForExport: false, typeApproval: "M1", wheelplan: "2 AXLE RIGID BODY",
  },
  BM19EEE: {
    registrationNumber: "BM19EEE", taxStatus: "Untaxed", taxDueDate: "2026-06-01", motStatus: "Not valid", motExpiryDate: "2026-05-20",
    make: "BMW", yearOfManufacture: 2019, monthOfFirstRegistration: "2019-04", engineCapacity: 1995, fuelType: "DIESEL",
    colour: "BLACK", co2Emissions: 124, markedForExport: false, typeApproval: "M1", wheelplan: "2 AXLE RIGID BODY",
  },
};

export const DVSA_FIXTURES: Record<string, DvsaResponse> = {
  MK20AMG: {
    registration: "MK20AMG", make: "MERCEDES-BENZ", model: "AMG GT", firstUsedDate: "2020-03-02", fuelType: "Petrol",
    primaryColour: "Grey", registrationDate: "2020-03-02", manufactureDate: "2020-02-11", engineSize: "3982", hasOutstandingRecall: "No",
    motTests: [
      { completedDate: "2026-02-10T11:20:00.000Z", testResult: "PASSED", expiryDate: "2027-02-14", odometerValue: "28411", odometerUnit: "MI", odometerResultType: "READ", motTestNumber: "100000000001", dataSource: "DVSA", defects: [] },
      { completedDate: "2025-02-12T09:00:00.000Z", testResult: "PASSED", expiryDate: "2026-02-14", odometerValue: "21950", odometerUnit: "MI", odometerResultType: "READ", motTestNumber: "100000000002", dataSource: "DVSA", defects: [] },
    ],
  },
  WR70XYZ: {
    registration: "WR70XYZ", make: "VOLKSWAGEN", model: "GOLF", firstUsedDate: "2020-09-15", fuelType: "Diesel",
    primaryColour: "Blue", registrationDate: "2020-09-15", manufactureDate: "2020-08-20", engineSize: "1968", hasOutstandingRecall: "Unknown",
    motTests: [
      { completedDate: "2025-11-28T14:05:00.000Z", testResult: "PASSED", expiryDate: "2026-11-30", odometerValue: "61240", odometerUnit: "MI", odometerResultType: "READ", motTestNumber: "100000000003", dataSource: "DVSA", defects: [{ text: "Nearside front tyre worn close to legal limit", type: "ADVISORY", dangerous: false }] },
      { completedDate: "2024-11-25T10:30:00.000Z", testResult: "FAILED", odometerValue: "48870", odometerUnit: "MI", odometerResultType: "READ", motTestNumber: "100000000004", dataSource: "DVSA", defects: [{ text: "Headlamp aim too high", type: "MAJOR", dangerous: false }] },
      { completedDate: "2023-09-12T10:30:00.000Z", testResult: "PASSED", expiryDate: "2024-09-14", odometerValue: "36102", odometerUnit: "MI", odometerResultType: "READ", motTestNumber: "100000000005", dataSource: "DVSA", defects: [] },
    ],
  },
  BM19EEE: {
    registration: "BM19EEE", make: "BMW", model: "320D", firstUsedDate: "2019-04-01", fuelType: "Diesel",
    primaryColour: "Black", registrationDate: "2019-04-01", manufactureDate: "2019-03-10", engineSize: "1995", hasOutstandingRecall: "No",
    motTests: [
      // Imported cluster read in kilometres: 150,000 km is about 93,207 miles.
      { completedDate: "2025-05-18T08:45:00.000Z", testResult: "PASSED", expiryDate: "2026-05-20", odometerValue: "150000", odometerUnit: "KM", odometerResultType: "READ", motTestNumber: "100000000006", dataSource: "DVSA", defects: [] },
    ],
  },
};
