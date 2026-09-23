/**
 * The BitCRM colour tokens, in one place.
 *
 * LIGHT is Workiz. Every value was sampled from their own screenshots
 * (workiz-data-parser/data/ui_reference) rather than eyeballed, because the
 * people using this product are moving off Workiz and should not have to
 * relearn what a screen looks like.
 *
 * DARK is ours. Workiz has no dark theme to copy, so it is derived: the same
 * surface layering, the same meanings, the status hues lifted until they read
 * on a dark ground — and held to the same contrast thresholds as light, which
 * tokens.test.ts checks rather than trusts.
 *
 * This module is the source of truth; app/globals.css is generated from it.
 */

export type TokenName = keyof typeof LIGHT;

export const LIGHT = {
  // Surfaces. Workiz puts grey behind the page and white on the cards and
  // grid rows, which is what makes their tables read as tables.
  background: "#f7f7f7",
  foreground: "#3b4b52",
  card: "#ffffff",
  cardForeground: "#3b4b52",
  popover: "#ffffff",
  popoverForeground: "#3b4b52",
  muted: "#f7f7f7",
  mutedForeground: "#5e5e5e",

  // The yellow. It is a surface, never a text colour — see primaryForeground.
  primary: "#fad400",
  primaryForeground: "#3b4b52",
  brand: "#fad400",
  brandForeground: "#3b4b52",

  // The blue does the second-rank actions, the links and the focus ring.
  secondary: "#3589e9",
  secondaryForeground: "#ffffff",

  // The row tint Workiz uses for selection and hover.
  accent: "#e5f1ff",
  accentForeground: "#3b4b52",

  // Status. These replace the 599 hand-written amber/emerald/sky literals.
  destructive: "#be2c2c",
  destructiveForeground: "#ffffff",
  success: "#198218",
  successForeground: "#ffffff",
  warning: "#ffa500",
  warningForeground: "#3b4b52",
  info: "#3589e9",
  infoForeground: "#ffffff",

  // Text for the tinted status pills. The base colours above are fills — the
  // Workiz orange is 1.98:1 on white — so each tone gets the same hue pushed
  // dark enough to read. lib/theme/tone.ts is the only thing that uses these.
  neutral: "#64748b",
  neutralText: "#48555c",
  infoText: "#1b5fae",
  successText: "#136b12",
  warningText: "#8a5a00",
  destructiveText: "#a02525",

  // Lines. Deliberately fainter than the 3:1 non-text guideline — Workiz grid
  // rules are this light, and darkening them reads as a different product.
  border: "#dfe2e3",
  input: "#dddddd",
  ring: "#3589e9",

  // Chrome.
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

export const DARK: Record<TokenName, string> = {
  // Same layering as light, upside down: the page sits below the card.
  background: "#14181a",
  foreground: "#e8edef",
  card: "#1c2224",
  cardForeground: "#e8edef",
  popover: "#1f2628",
  popoverForeground: "#e8edef",
  muted: "#1f2628",
  mutedForeground: "#a3b0b5",

  // The logo yellow is untouched; the action surface is taken down a step so
  // it does not glare against a dark page.
  primary: "#e8c400",
  primaryForeground: "#14181a",
  brand: "#fad400",
  brandForeground: "#14181a",

  // Pulled slightly darker than the Workiz blue so white still sits on it.
  secondary: "#2f7ed8",
  secondaryForeground: "#ffffff",

  accent: "#223039",
  accentForeground: "#e8edef",

  // Status hues lifted — a dark ground eats saturation.
  destructive: "#ef6a6a",
  destructiveForeground: "#14181a",
  success: "#3acf7d",
  successForeground: "#14181a",
  warning: "#ffc04d",
  warningForeground: "#14181a",
  info: "#4d97ec",
  infoForeground: "#14181a",

  // Same hues, lifted instead of deepened: a dark card needs light ink.
  neutral: "#7d8b96",
  neutralText: "#a3b0b5",
  infoText: "#7bb4f2",
  successText: "#5fdc97",
  warningText: "#ffcf80",
  destructiveText: "#ff9a9a",

  border: "#2c3437",
  input: "#343d41",
  ring: "#4d97ec",

  topbar: "#1a1f21",
  topbarForeground: "#e8edef",
  topbarBorder: "#2c3437",
  sidebar: "#1a1f21",
  sidebarForeground: "#e8edef",
  sidebarAccent: "#242c2f",
  sidebarAccentForeground: "#e8edef",
  sidebarBorder: "#2c3437",
  sidebarRing: "#4d97ec",
};

/** Pairs that carry running text: WCAG AA, 4.5:1, in both themes. */
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
