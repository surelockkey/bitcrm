/**
 * The single source of colour, spacing and touch sizing for the app.
 *
 * The palette is chosen for a technician holding the phone at arm's length in
 * direct sun, often with a glove on, so the numbers here are requirements
 * rather than taste (docs/ARCHITECTURE.md §2.8, §2.9):
 *
 *   - body text sits at 7:1 (WCAG AAA) against whatever it is painted on, and
 *     even the muted text stays above 7:1 — `tokens.test.ts` asserts it, so a
 *     later "let's soften that grey" is caught by the suite rather than by a
 *     technician squinting at a driveway;
 *   - a status is never colour alone — the pill carries a word and a shape too;
 *   - the dark theme is genuinely dark, because a lot of this work happens at
 *     night and a grey "dark mode" is a torch pointed at the eye.
 */

export interface ThemeColors {
  /** Page background. */
  background: string;
  /** Raised surface: cards, sheets, the tab bar. */
  surface: string;
  /** A surface one step further from the page (inputs, nested rows). */
  surfaceSunken: string;
  border: string;
  /** Body text. */
  text: string;
  /** Secondary text: labels, captions, timestamps. */
  textMuted: string;
  /** Text painted on `primary`/`danger`/`success` fills. */
  onAccent: string;
  primary: string;
  danger: string;
  success: string;
  warning: string;
  /** Faint tint of `primary`, for selected rows and quiet badges. */
  primarySoft: string;
  warningSoft: string;
  dangerSoft: string;
  successSoft: string;
}

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F1F4F8',
  surfaceSunken: '#E4EAF1',
  border: '#B9C4D0',
  text: '#0D1117',
  textMuted: '#414D5C',
  onAccent: '#FFFFFF',
  primary: '#0A47B8',
  danger: '#A2131A',
  success: '#0C5C3B',
  warning: '#6B4100',
  primarySoft: '#DCE7FB',
  warningSoft: '#FBEEDA',
  dangerSoft: '#FBE1E1',
  successSoft: '#DCF0E7',
};

export const darkColors: ThemeColors = {
  background: '#05090F',
  surface: '#101822',
  surfaceSunken: '#0A111A',
  border: '#2C3C50',
  text: '#F6F8FB',
  textMuted: '#B4C0CE',
  onAccent: '#04101F',
  primary: '#7DB2FF',
  danger: '#FF9A93',
  success: '#59D7A4',
  warning: '#FFC861',
  primarySoft: '#16273D',
  warningSoft: '#33260C',
  dangerSoft: '#3A1815',
  successSoft: '#0E2C22',
};

/** 4 dp rhythm. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Touch sizing. Apple's floor is 44 pt and Android's 48 dp; a gloved thumb on a
 * cold morning gets 56, and the job's primary action gets a full-width 64.
 */
export const touch = {
  /** Minimum tappable square for any action. */
  min: 56,
  /** Height of a screen's primary call to action. */
  primary: 64,
  /** Minimum gap between two targets, so "Cancel" is never a mis-tap away. */
  gap: 12,
} as const;

/**
 * Type scale. Nothing lighter than 500 — thin strokes disappear in sunlight —
 * and no line is given a fixed height, so `fontScale` 1.3 simply grows the row.
 */
export const type = {
  display: { fontSize: 28, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 17, fontWeight: '500' },
  label: { fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '600' },
} as const;

/* --------------------------------------------------------------- contrast */

/** sRGB relative luminance of `#rrggbb`, per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1…21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
