import { describe, expect, it } from "vitest";
import { decideRegChange, retitleForReg } from "../src/modules/vehicles/service";

const car = { id: "veh_a", reg: "AB12CDE" };

describe("registration corrections", () => {
  it("does nothing when the plate is the same", () => {
    expect(decideRegChange({ current: car, newReg: "AB12CDE", existingWithNewReg: null, otherUses: 3 })).toBe("unchanged");
    expect(decideRegChange({ current: null, newReg: null, existingWithNewReg: null, otherUses: 0 })).toBe("unchanged");
  });
  it("unlinks the car when the plate is cleared", () => {
    expect(decideRegChange({ current: car, newReg: null, existingWithNewReg: null, otherUses: 0 })).toBe("cleared");
  });
  it("links to a car already in the Hub with the new plate, even if the old car is only used here", () => {
    expect(decideRegChange({ current: car, newReg: "WR70XYZ", existingWithNewReg: { id: "veh_b" }, otherUses: 0 })).toBe("relinked");
    expect(decideRegChange({ current: null, newReg: "WR70XYZ", existingWithNewReg: { id: "veh_b" }, otherUses: 0 })).toBe("relinked");
  });
  it("fixes a typo in place when nothing else uses the car", () => {
    expect(decideRegChange({ current: car, newReg: "AB12CDF", existingWithNewReg: null, otherUses: 0 })).toBe("corrected");
  });
  it("adds a new car when the old one is used by other jobs or bookings", () => {
    expect(decideRegChange({ current: car, newReg: "AB12CDF", existingWithNewReg: null, otherUses: 1 })).toBe("created");
  });
  it("adds a new car when there was none", () => {
    expect(decideRegChange({ current: null, newReg: "AB12CDF", existingWithNewReg: null, otherUses: 0 })).toBe("created");
  });
});

describe("job titles follow the plate", () => {
  it("swaps the plate at the end of a generated title", () => {
    expect(retitleForReg("Keys and immobiliser · AB12 CDE", "AB12CDE", "AB12CDF")).toBe("Keys and immobiliser · AB12 CDF");
    expect(retitleForReg("ECU remap · A123BCD", "A123BCD", "WR70XYZ")).toBe("ECU remap · WR70 XYZ");
  });
  it("drops the plate when it's cleared", () => {
    expect(retitleForReg("Keys and immobiliser · AB12 CDE", "AB12CDE", null)).toBe("Keys and immobiliser");
  });
  it("leaves titles that don't end with the old plate alone", () => {
    expect(retitleForReg("Spare key for the Merc", "AB12CDE", "AB12CDF")).toBe("Spare key for the Merc");
    expect(retitleForReg("Keys and immobiliser", null, "AB12CDF")).toBe("Keys and immobiliser");
  });
});
