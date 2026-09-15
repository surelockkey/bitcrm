import { describe, it, expect } from "vitest";
import { countSegments, isGsm7 } from "./segments";

describe("isGsm7", () => {
  it("accepts the basic alphabet and common punctuation", () => {
    expect(isGsm7("Hi John, your tech is on the way! Call (404) 555-1234.")).toBe(true);
  });

  it("accepts extended characters", () => {
    expect(isGsm7("Total: 12€ {ok} [x] ~ ^ | \\")).toBe(true);
  });

  it("rejects characters outside GSM-7", () => {
    expect(isGsm7("Привіт")).toBe(false);
    expect(isGsm7("Great 👍")).toBe(false);
    expect(isGsm7("It’s done")).toBe(false); // curly apostrophe
  });
});

describe("countSegments", () => {
  it("counts nothing for an empty body", () => {
    expect(countSegments("")).toEqual({
      encoding: "GSM-7",
      units: 0,
      segments: 0,
      perSegment: 160,
      remaining: 160,
    });
  });

  it("fits 160 GSM-7 characters in one segment", () => {
    const info = countSegments("a".repeat(160));
    expect(info.segments).toBe(1);
    expect(info.remaining).toBe(0);
  });

  it("splits GSM-7 at 153 per segment once concatenated", () => {
    expect(countSegments("a".repeat(161)).segments).toBe(2);
    expect(countSegments("a".repeat(306)).segments).toBe(2);
    expect(countSegments("a".repeat(307)).segments).toBe(3);
  });

  it("charges two septets for extended characters", () => {
    const info = countSegments("€".repeat(80));
    expect(info.encoding).toBe("GSM-7");
    expect(info.units).toBe(160);
    expect(info.segments).toBe(1);
    expect(countSegments("€".repeat(81)).segments).toBe(2);
  });

  it("flips the whole message to UCS-2 on one non-GSM character", () => {
    const info = countSegments("a".repeat(69) + "👍");
    expect(info.encoding).toBe("UCS-2");
    // 69 + a surrogate pair (2 code units) = 71 → over the 70-unit single segment.
    expect(info.units).toBe(71);
    expect(info.segments).toBe(2);
  });

  it("splits UCS-2 at 67 per segment once concatenated", () => {
    expect(countSegments("я".repeat(70)).segments).toBe(1);
    expect(countSegments("я".repeat(71)).segments).toBe(2);
    expect(countSegments("я".repeat(134)).segments).toBe(2);
    expect(countSegments("я".repeat(135)).segments).toBe(3);
  });
});
