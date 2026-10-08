import { describe, it, expect } from "vitest";
import { axisDayLabel, seriesTotals } from "./jobs-by-status";

describe("seriesTotals", () => {
  it("adds each state across the window", () => {
    expect(
      seriesTotals([
        { day: "2026-09-14", open: 1, done: 51, canceled: 80 },
        { day: "2026-09-15", open: 2, done: 45, canceled: 74 },
      ]),
    ).toEqual({ open: 3, done: 96, canceled: 154 });
  });

  it("an empty window is zeros, not NaN", () => {
    expect(seriesTotals([])).toEqual({ open: 0, done: 0, canceled: 0 });
  });
});

/** Підписи осі — як у Workiz: «Sep 14th», з правильним порядковим суфіксом. */
describe("axisDayLabel", () => {
  it("writes the month and an ordinal day", () => {
    expect(axisDayLabel("2026-09-14")).toBe("Sep 14th");
    expect(axisDayLabel("2026-09-21")).toBe("Sep 21st");
    expect(axisDayLabel("2026-09-22")).toBe("Sep 22nd");
    expect(axisDayLabel("2026-09-23")).toBe("Sep 23rd");
  });

  // 11th/12th/13th — не «st/nd/rd», попри останню цифру.
  it("gets the teens right", () => {
    expect(axisDayLabel("2026-09-11")).toBe("Sep 11th");
    expect(axisDayLabel("2026-09-12")).toBe("Sep 12th");
    expect(axisDayLabel("2026-09-13")).toBe("Sep 13th");
  });

  it("reads the day as written, without a timezone shifting it", () => {
    expect(axisDayLabel("2026-01-01")).toBe("Jan 1st");
  });
});
