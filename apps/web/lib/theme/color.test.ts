import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance } from "./color";

describe("relativeLuminance", () => {
  it("is 1 for white and 0 for black", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("accepts three-digit hex and is case-insensitive", () => {
    expect(relativeLuminance("#FFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#FaD400")).toBeCloseTo(
      relativeLuminance("#fad400"),
      5,
    );
  });

  it("applies the sRGB transfer curve, not a plain average", () => {
    // Mid grey is ~0.216 in linear light, far below the naive 0.5.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("rejects anything that is not a hex colour", () => {
    expect(() => relativeLuminance("rgb(0,0,0)")).toThrow(/hex colour/i);
    expect(() => relativeLuminance("#12345")).toThrow(/hex colour/i);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#fad400", "#fad400")).toBeCloseTo(1, 5);
  });

  it("does not care which colour is the foreground", () => {
    expect(contrastRatio("#3b4b52", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#3b4b52"),
      5,
    );
  });

  it("agrees with the WCAG reference value for the 4.5:1 boundary grey", () => {
    // #767676 on white is the darkest grey that still clears AA body text.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("scores the Workiz ink on the Workiz page background as AA body text", () => {
    expect(contrastRatio("#3b4b52", "#f7f7f7")).toBeGreaterThanOrEqual(4.5);
  });

  it("scores Workiz yellow against white as too weak for body text", () => {
    // The yellow is a surface colour, never a text colour on white — the
    // redesign has to put dark ink on it, and this pins that down.
    expect(contrastRatio("#fad400", "#ffffff")).toBeLessThan(3);
  });
});
