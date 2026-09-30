import { describe, expect, it } from "vitest";
import { formatDateTime, formatJobDate, formatQty, rangeLabel } from "./format";

describe("formatQty", () => {
  it("two decimals and grouped digits, as Workiz prints quantities", () => {
    expect(formatQty(1)).toBe("1.00");
    expect(formatQty(553)).toBe("553.00");
    expect(formatQty(1234.5)).toBe("1,234.50");
  });

  it("no number is a dash", () => {
    expect(formatQty(undefined)).toBe("—");
    expect(formatQty(Number.NaN)).toBe("—");
  });
});

describe("formatJobDate", () => {
  it("a job's day reads as Workiz writes it, whatever the reader's time zone", () => {
    expect(formatJobDate("2026-09-29")).toBe("Tue Sep 29, 2026");
  });

  it("a full timestamp is read for its day", () => {
    expect(formatJobDate("2026-09-29T00:00:00.000Z")).toMatch(/Sep 2[89], 2026$/);
  });

  it("nothing, or nonsense, is a dash or itself", () => {
    expect(formatJobDate(undefined)).toBe("—");
    expect(formatJobDate("soon")).toBe("soon");
  });
});

describe("formatDateTime", () => {
  it("reads like Workiz's return date: 'Fri Oct 20 2023 10:41 am'", () => {
    const local = new Date(2023, 9, 20, 10, 41).toISOString();
    expect(formatDateTime(local)).toBe("Fri Oct 20 2023 10:41 am");
    const evening = new Date(2023, 3, 7, 19, 12).toISOString();
    expect(formatDateTime(evening)).toBe("Fri Apr 7 2023 7:12 pm");
  });

  it("nothing is a dash", () => {
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("rangeLabel", () => {
  it("the window, spelled out", () => {
    expect(rangeLabel("2023-01-01", "2023-10-20")).toBe("Jan 1, 2023 – Oct 20, 2023");
  });
});
