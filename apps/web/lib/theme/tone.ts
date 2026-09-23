/**
 * Tinted status pills — one definition for the whole app.
 *
 * Four places had independently grown the same string
 * (`border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300`):
 * features/invoices, features/estimates, features/job-tags and
 * packages/portal-ui. They are the reason 599 raw palette literals are in the
 * codebase, and they are why dark mode looks wrong in places — the light half
 * of each pair was picked by hand and the dark half was an afterthought.
 *
 * A tone is now three token-driven classes, and the `dark:` variant disappears
 * because the tokens themselves already differ per theme.
 */

export const TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "destructive",
] as const;

export type Tone = (typeof TONES)[number];

/**
 * Faint border, fainter fill, readable text.
 *
 * The text uses the tone's `-text` token rather than its base colour: the base
 * is a fill (Workiz orange on white is 1.98:1, nowhere near readable), while
 * the `-text` variant is the same hue pushed until it clears AA on a card.
 */
export function toneClasses(tone: Tone): string {
  return `border-${tone}/30 bg-${tone}/10 text-${tone}-text`;
}
