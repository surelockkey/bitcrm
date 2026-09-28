import { describe, it, expect } from "vitest";
import {
  RANGE_PRESETS,
  axisDayLabel,
  rangeWindow,
  seriesTotals,
  type DashboardRange,
} from "./jobs-by-status";

/**
 * Вікно, яке підписано «Last 14 Days».
 *
 * У Workiz воно охоплює **п'ятнадцять** стовпчиків: на їхньому скриншоті
 * «Last 14 Days» іде з Sep 14 по Sep 28 включно. Тобто N — це «на скільки днів
 * назад», а не «скільки стовпчиків», і обидва кінці входять. Виглядає як
 * помилка на одиницю, нею не є — це паритет, і саме тому тут тест.
 */
describe("rangeWindow", () => {
  const today = new Date("2026-09-28T09:00:00.000Z");

  it("reaches N days back and includes both ends", () => {
    expect(rangeWindow(14, today)).toEqual({ from: "2026-09-14", to: "2026-09-28" });
  });

  it("a week is eight bars, the same way", () => {
    expect(rangeWindow(7, today)).toEqual({ from: "2026-09-21", to: "2026-09-28" });
  });

  it("crosses a month boundary", () => {
    expect(rangeWindow(7, new Date("2026-10-03T09:00:00.000Z"))).toEqual({
      from: "2026-09-26",
      to: "2026-10-03",
    });
  });

  it("offers the presets the card's picker shows", () => {
    expect(RANGE_PRESETS.map((p) => p.label)).toEqual([
      "Last 7 Days",
      "Last 14 Days",
      "Last 30 Days",
    ]);
  });

  // Сервер відмовляє довшому за 92 дні; жоден пресет не має в це впертися.
  it("every preset stays inside the window the server allows", () => {
    for (const preset of RANGE_PRESETS) {
      const { from, to } = rangeWindow(preset.days, today);
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      expect(span + 1).toBeLessThanOrEqual(92);
    }
  });

  it("is typed to the presets it offers", () => {
    const r: DashboardRange = 14;
    expect(RANGE_PRESETS.some((p) => p.days === r)).toBe(true);
  });
});

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
