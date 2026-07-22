/**
 * The fixed palette a job tag's color is chosen from. One source of truth:
 * the backend validates against it (`@IsIn(JOB_TAG_COLORS)`) and the web maps
 * each token to a light/dark-safe chip class. Tokens, not raw hex, so contrast
 * is handled once and stays theme-aware.
 */
export const JOB_TAG_COLORS = [
  'slate',
  'red',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;

export type JobTagColor = (typeof JOB_TAG_COLORS)[number];
