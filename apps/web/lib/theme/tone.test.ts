import { describe, expect, it } from "vitest";

import { TONES, toneClasses } from "./tone";

describe("tones", () => {
  it("covers every tone the old per-feature maps needed", () => {
    expect([...TONES].sort()).toEqual(["destructive", "info", "neutral", "success", "warning"]);
  });

  it("builds a tinted pill from the tone's own tokens", () => {
    expect(toneClasses("warning")).toBe("border-warning/30 bg-warning/10 text-warning-text");
    expect(toneClasses("destructive")).toBe(
      "border-destructive/30 bg-destructive/10 text-destructive-text",
    );
  });

  it("never reaches for a raw Tailwind palette colour", () => {
    const palette =
      /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/;
    for (const tone of TONES) {
      expect(toneClasses(tone), tone).not.toMatch(palette);
    }
  });

  it("gives every tone the same three-part shape", () => {
    for (const tone of TONES) {
      const parts = toneClasses(tone).split(" ");
      expect(parts, tone).toHaveLength(3);
      expect(parts[0], tone).toBe(`border-${tone}/30`);
      expect(parts[1], tone).toBe(`bg-${tone}/10`);
      expect(parts[2], tone).toBe(`text-${tone}-text`);
    }
  });
});
