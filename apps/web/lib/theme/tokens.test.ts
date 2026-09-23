import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance as lum } from "./color";
import {
  BODY_TEXT_PAIRS,
  DARK,
  LIGHT,
  UI_TEXT_PAIRS,
  type TokenName,
} from "./tokens";

/** Colours read off the Workiz screenshots in workiz-data-parser/data/ui_reference. */
const WORKIZ = {
  pageBackground: "#f7f7f7",
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

describe("the two themes", () => {
  it("define exactly the same token names", () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it("give every token a hex value", () => {
    for (const [theme, tokens] of [
      ["light", LIGHT],
      ["dark", DARK],
    ] as const) {
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `${theme}.${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("are actually different — every surface is re-chosen for dark", () => {
    const surfaces: TokenName[] = [
      "background",
      "foreground",
      "card",
      "popover",
      "muted",
      "mutedForeground",
      "accent",
      "border",
      "input",
      "sidebar",
      "topbar",
    ];
    for (const name of surfaces) {
      expect(DARK[name], name).not.toBe(LIGHT[name]);
    }
  });

  it("keeps the brand yellow itself identical in both themes", () => {
    // The logo colour is the one thing that must not drift between themes.
    expect(DARK.brand).toBe(LIGHT.brand);
  });
});

describe("the light theme is Workiz", () => {
  it("uses the Workiz chrome colours", () => {
    expect(LIGHT.background).toBe(WORKIZ.pageBackground);
    expect(LIGHT.card).toBe(WORKIZ.card);
    expect(LIGHT.topbar).toBe(WORKIZ.topbar);
    expect(LIGHT.topbarBorder).toBe(WORKIZ.topbarBorder);
    expect(LIGHT.sidebar).toBe(WORKIZ.card);
  });

  it("uses the Workiz yellow as the primary action and the brand", () => {
    expect(LIGHT.primary).toBe(WORKIZ.yellow);
    expect(LIGHT.brand).toBe(WORKIZ.yellow);
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

describe("the dark theme is ours, derived — not inverted", () => {
  it("does not simply flip the light theme", () => {
    expect(DARK.background).not.toBe(LIGHT.foreground);
    expect(DARK.foreground).not.toBe(LIGHT.background);
  });

  it("keeps surfaces layered: page darker than card, card darker than popover edge", () => {
    expect(lum(DARK.background)).toBeLessThan(lum(DARK.card));
    expect(lum(DARK.card)).toBeLessThan(lum(DARK.border));
  });

  it("keeps the same surface layering as light, in the opposite direction", () => {
    expect(lum(LIGHT.background)).toBeLessThan(lum(LIGHT.card));
  });

  it("lifts the status colours so they survive a dark surface", () => {
    for (const name of ["destructive", "success", "warning"] as const) {
      expect(lum(DARK[name]), name).toBeGreaterThan(lum(LIGHT[name]));
    }
  });
});

describe("contrast holds in both themes", () => {
  it.each(["light", "dark"] as const)(
    "%s clears WCAG AA (4.5:1) for every body-text pair",
    (theme) => {
      const tokens = theme === "light" ? LIGHT : DARK;
      for (const [fg, bg] of BODY_TEXT_PAIRS) {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        expect(ratio, `${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}`,).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "%s clears 3:1 for every button and focus pair",
    (theme) => {
      const tokens = theme === "light" ? LIGHT : DARK;
      for (const [fg, bg] of UI_TEXT_PAIRS) {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        expect(ratio, `${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}`,).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
