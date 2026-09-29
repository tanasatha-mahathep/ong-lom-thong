import { describe, expect, it } from "vitest";
import { addDaysIso, isoToThaiInput, thaiInputToIso } from "./thai-date";

describe("thai-date", () => {
  it("shows ISO dates as the BE text staff type", () => {
    expect(isoToThaiInput("2026-09-28")).toBe("28/09/2569");
    expect(isoToThaiInput("not a date")).toBe("not a date");
  });

  it("reads BE and CE text back to ISO, and rejects dates that do not exist", () => {
    expect(thaiInputToIso("28/09/2569")).toBe("2026-09-28");
    expect(thaiInputToIso("1/10/2026")).toBe("2026-10-01");
    expect(thaiInputToIso("29/02/2569")).toBeNull();
    expect(thaiInputToIso("")).toBeNull();
  });

  it("moves across months and years", () => {
    expect(addDaysIso("2026-09-29", -7)).toBe("2026-09-22");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
