/**
 * The BitCRM colour tokens, in one place.
 *
 * Every value is sampled from Workiz's own screenshots
 * (workiz-data-parser/data/ui_reference) rather than eyeballed, because the
 * people using this product are moving off Workiz and should not have to
 * relearn what a screen looks like.
 *
 * Light only, on purpose. Workiz has no dark theme to copy, so a dark one
 * would be invention rather than parity, and it is deliberately left out of
 * this pass — see the note in app/providers.tsx.
 *
 * This module is the source of truth; app/globals.css is generated from it,
 * and app/globals.test.ts fails if the two drift.
 */

export type TokenName = keyof typeof LIGHT;

export const LIGHT = {
  // Surfaces. The content section is white — the grey is not a canvas, it is
  // a separator: the strips above the content, the table header and the zebra
  // row. Painting the whole page grey is the mistake that makes a Workiz
  // clone look like something else.
  background: "#ffffff",
  foreground: "#3b4b52",
  card: "#ffffff",
  cardForeground: "#3b4b52",
  popover: "#ffffff",
  popoverForeground: "#3b4b52",
  muted: "#f7f7f7",
  mutedForeground: "#5e5e5e",

  // The yellow, and only on the one action per screen that Workiz spends it
  // on ("+ Create New"). It is a fill, never a text colour — 1.45:1 on white.
  primary: "#fad400",
  primaryForeground: "#3b4b52",

  // Everything else interactive is their blue: links, checkboxes, switches,
  // selected states, the focus ring. `brand` was the yellow for one commit and
  // it turned the whole chat yellow at once.
  brand: "#3589e9",
  brandForeground: "#ffffff",
  secondary: "#3589e9",
  secondaryForeground: "#ffffff",

  // The row tint Workiz uses for selection and hover.
  accent: "#e5f1ff",
  accentForeground: "#3b4b52",

  // Status fills.
  destructive: "#be2c2c",
  destructiveForeground: "#ffffff",
  success: "#198218",
  successForeground: "#ffffff",
  warning: "#ffa500",
  warningForeground: "#3b4b52",
  info: "#3589e9",
  infoForeground: "#ffffff",

  // Text for the tinted status pills. The fills above cannot carry their own
  // label — Workiz orange is 1.98:1 on white — so each tone gets the same hue
  // pushed dark enough to read. Only lib/theme/tone.ts uses these.
  neutral: "#64748b",
  neutralText: "#48555c",
  infoText: "#1b5fae",
  successText: "#136b12",
  warningText: "#8a5a00",
  destructiveText: "#a02525",

  // Lines. Deliberately fainter than the 3:1 non-text guideline — Workiz grid
  // rules are this light, and darkening them reads as a different product.
  border: "#dfe2e3",
  input: "#cccccc",
  ring: "#3589e9",
  // The grid rules are their own, darker line: #cfcfcf between every column
  // of the jobs table. The chrome border disappears at that density.
  tableBorder: "#cfcfcf",

  // Chrome. Their top bar is 56px with a one-pixel rule under it.
  topbar: "#f3f6f7",
  topbarForeground: "#3b4b52",
  topbarBorder: "#dfe2e3",
  sidebar: "#ffffff",
  sidebarForeground: "#3b4b52",
  sidebarAccent: "#f3f6f7",
  sidebarAccentForeground: "#3b4b52",
  sidebarBorder: "#dfe2e3",
  sidebarRing: "#3589e9",
} as const satisfies Record<string, string>;

/** Pairs that carry running text: WCAG AA, 4.5:1. */
export const BODY_TEXT_PAIRS: ReadonlyArray<[TokenName, TokenName]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["mutedForeground", "card"],
  ["mutedForeground", "background"],
  ["mutedForeground", "muted"],
  ["accentForeground", "accent"],
  ["sidebarForeground", "sidebar"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["topbarForeground", "topbar"],
  ["neutralText", "card"],
  ["neutralText", "background"],
  ["infoText", "card"],
  ["infoText", "background"],
  ["successText", "card"],
  ["successText", "background"],
  ["warningText", "card"],
  ["warningText", "background"],
  ["destructiveText", "card"],
  ["destructiveText", "background"],
  // The chat's quick-reply chips: deep blue label on the pale blue row tint.
  ["infoText", "accent"],
];

/** Button labels and focus rings: 3:1 is the bar for large and non-text. */
export const UI_TEXT_PAIRS: ReadonlyArray<[TokenName, TokenName]> = [
  ["primaryForeground", "primary"],
  ["brandForeground", "brand"],
  ["secondaryForeground", "secondary"],
  ["destructiveForeground", "destructive"],
  ["successForeground", "success"],
  ["warningForeground", "warning"],
  ["infoForeground", "info"],
  ["ring", "card"],
  ["ring", "background"],
];
