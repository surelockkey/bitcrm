import { describe, expect, it } from "vitest";
import { techColor, TECH_PALETTE } from "./tech-color";

describe("techColor", () => {
  it("is stable for the same id", () => {
    expect(techColor("user-abc")).toBe(techColor("user-abc"));
  });

  it("only ever returns palette colours", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "zzz", "user-123"]) {
      expect(TECH_PALETTE).toContain(techColor(id));
    }
  });

  it("never returns red (reserved for unassigned work)", () => {
    expect(TECH_PALETTE).not.toContain("#dc2626");
    expect(TECH_PALETTE).not.toContain("#ef4444");
  });

  it("falls back to the first hue for an empty id", () => {
    expect(techColor(undefined)).toBe(TECH_PALETTE[0]);
    expect(techColor("")).toBe(TECH_PALETTE[0]);
  });

  it("spreads a handful of ids across more than one colour", () => {
    const colours = new Set(
      ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map((id) => techColor(id)),
    );
    expect(colours.size).toBeGreaterThan(1);
  });
});
