import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance as lum } from "./color";
import { BODY_TEXT_PAIRS, LIGHT, UI_TEXT_PAIRS } from "./tokens";

/** Colours read off the Workiz screenshots in workiz-data-parser/data/ui_reference. */
const WORKIZ = {
  content: "#ffffff",
  greyStrip: "#f7f7f7",
  card: "#ffffff",
  topbar: "#f3f6f7",
  topbarBorder: "#dfe2e3",
  yellow: "#fad400",
  blue: "#3589e9",
  ink: "#3b4b52",
  secondaryInk: "#5e5e5e",
  border: "#dddddd",
  selectedRow: "#e5f1ff",
  red: "#be2c2c",
  green: "#198218",
  orange: "#ffa500",
} as const;

describe("the palette", () => {
  it("gives every token a six-digit hex value", () => {
    for (const [name, value] of Object.entries(LIGHT)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the theme is Workiz", () => {
  it("uses the Workiz chrome colours", () => {
    expect(LIGHT.background).toBe(WORKIZ.content);
    expect(LIGHT.card).toBe(WORKIZ.card);
    expect(LIGHT.topbar).toBe(WORKIZ.topbar);
    expect(LIGHT.topbarBorder).toBe(WORKIZ.topbarBorder);
    expect(LIGHT.sidebar).toBe(WORKIZ.card);
  });

  it("keeps the content section white and the grey for strips and zebra rows", () => {
    expect(LIGHT.background).toBe(WORKIZ.content);
    expect(LIGHT.card).toBe(WORKIZ.content);
    expect(LIGHT.muted).toBe(WORKIZ.greyStrip);
    // The strips above the content read as separators only if they are darker
    // than what they sit on.
    expect(lum(LIGHT.muted)).toBeLessThan(lum(LIGHT.background));
    expect(lum(LIGHT.topbar)).toBeLessThan(lum(LIGHT.background));
  });

  it("spends the yellow on the primary action only", () => {
    // Workiz puts yellow on one thing per screen — "+ Create New" — and blue
    // on everything else that is interactive. Making `brand` yellow turned
    // every link, checkbox, switch and chat bubble yellow at once.
    expect(LIGHT.primary).toBe(WORKIZ.yellow);
    expect(LIGHT.brand).toBe(WORKIZ.blue);
    expect(LIGHT.brand).not.toBe(LIGHT.primary);
  });

  it("gives the brand accent enough contrast to be a link colour", () => {
    // The yellow cannot do this job: 1.45:1 on white.
    expect(contrastRatio(LIGHT.brand, LIGHT.card)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LIGHT.primary, LIGHT.card)).toBeLessThan(3);
  });

  it("puts Workiz ink on the yellow, never white", () => {
    expect(LIGHT.primaryForeground).toBe(WORKIZ.ink);
    expect(contrastRatio("#ffffff", LIGHT.primary)).toBeLessThan(3);
  });

  it("uses the Workiz blue for the secondary action, links and focus", () => {
    expect(LIGHT.secondary).toBe(WORKIZ.blue);
    expect(LIGHT.ring).toBe(WORKIZ.blue);
  });

  it("uses the Workiz ink scale for text", () => {
    expect(LIGHT.foreground).toBe(WORKIZ.ink);
    expect(LIGHT.mutedForeground).toBe(WORKIZ.secondaryInk);
  });

  it("uses the Workiz status colours", () => {
    expect(LIGHT.destructive).toBe(WORKIZ.red);
    expect(LIGHT.success).toBe(WORKIZ.green);
    expect(LIGHT.warning).toBe(WORKIZ.orange);
    expect(LIGHT.accent).toBe(WORKIZ.selectedRow);
  });

  it("keeps the Workiz row borders even though they are faint", () => {
    // Parity beats the 3:1 non-text guideline here: their grid lines are this
    // light, and a darker one would read as a different product.
    expect(LIGHT.input).toBe(WORKIZ.border);
    expect(contrastRatio(LIGHT.border, LIGHT.card)).toBeLessThan(3);
  });
});

describe("contrast", () => {
  it("clears WCAG AA (4.5:1) for every body-text pair", () => {
    for (const [fg, bg] of BODY_TEXT_PAIRS) {
      const ratio = contrastRatio(LIGHT[fg], LIGHT[bg]);
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clears 3:1 for every button label and focus ring", () => {
    for (const [fg, bg] of UI_TEXT_PAIRS) {
      const ratio = contrastRatio(LIGHT[fg], LIGHT[bg]);
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("checks the pill text against the surface it sits on, not its own fill", () => {
    // A tone's base colour is a fill: Workiz orange is 1.98:1 on white. The
    // -text variant is the same hue pushed until the label is readable.
    expect(contrastRatio(LIGHT.warning, LIGHT.card)).toBeLessThan(3);
    expect(contrastRatio(LIGHT.warningText, LIGHT.card)).toBeGreaterThanOrEqual(4.5);
  });
});
