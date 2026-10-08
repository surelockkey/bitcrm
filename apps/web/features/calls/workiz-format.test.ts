import { describe, expect, it } from "vitest";
import { formatWzCallDuration, formatWzCallTime } from "./workiz-format";

/**
 * The call log's Time column, as Workiz prints it (callspage_wz_02_scroll1,
 * `/node-voice/calls/report/` `created` + `call_duration`): the start on the
 * account's clock, "Thu Oct 8th, 3:15PM", over the length in words.
 */
describe("formatWzCallTime", () => {
  it("writes the start on the account's clock, Workiz's way", () => {
    // 19:15 UTC is 3:15 PM in New York (EDT).
    expect(formatWzCallTime("2026-10-08T19:15:00.000Z")).toBe("Thu Oct 8th, 3:15PM");
    expect(formatWzCallTime("2026-10-08T13:31:00.000Z")).toBe("Thu Oct 8th, 9:31AM");
  });

  it("keeps the minutes two digits and midnight / noon as 12", () => {
    expect(formatWzCallTime("2026-10-02T04:05:00.000Z")).toBe("Fri Oct 2nd, 12:05AM");
    expect(formatWzCallTime("2026-10-02T16:00:00.000Z")).toBe("Fri Oct 2nd, 12:00PM");
  });

  it("names the day the account saw, not the UTC one", () => {
    // 02:30 UTC on the 9th is still the evening of the 8th in New York.
    expect(formatWzCallTime("2026-10-09T02:30:00.000Z")).toBe("Thu Oct 8th, 10:30PM");
  });

  it("never adds a year — Workiz doesn't either", () => {
    expect(formatWzCallTime("2018-06-30T18:28:36.000Z")).toBe("Sat Jun 30th, 2:28PM");
  });

  it("can read another zone", () => {
    expect(formatWzCallTime("2026-10-08T19:15:00.000Z", "America/Chicago")).toBe("Thu Oct 8th, 2:15PM");
  });

  it("leaves a missing or broken instant blank", () => {
    expect(formatWzCallTime(undefined)).toBe("");
    expect(formatWzCallTime("not a date")).toBe("");
  });
});

describe("formatWzCallDuration", () => {
  it("says seconds alone under a minute", () => {
    expect(formatWzCallDuration(0)).toBe("0 Sec");
    expect(formatWzCallDuration(11)).toBe("11 Sec");
    expect(formatWzCallDuration(59)).toBe("59 Sec");
  });

  it("says minutes and seconds from a minute up, zero seconds included", () => {
    expect(formatWzCallDuration(60)).toBe("1 Min 0 Sec");
    expect(formatWzCallDuration(261)).toBe("4 Min 21 Sec");
  });

  it("never rolls minutes into hours", () => {
    expect(formatWzCallDuration(130 * 60 + 42)).toBe("130 Min 42 Sec");
  });

  it("drops fractions and treats nothing, negatives and junk as no time", () => {
    expect(formatWzCallDuration(65.9)).toBe("1 Min 5 Sec");
    expect(formatWzCallDuration(undefined)).toBe("0 Sec");
    expect(formatWzCallDuration(-17880)).toBe("0 Sec");
    expect(formatWzCallDuration(Number.NaN)).toBe("0 Sec");
  });
});
