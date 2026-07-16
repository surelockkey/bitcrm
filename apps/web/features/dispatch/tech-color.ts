/**
 * A stable colour per technician (story 4.01:337).
 *
 * The same technician is always the same colour — on their marker and on every
 * job pin assigned to them — so a dispatcher can read a route at a glance. Red
 * is deliberately absent: it's reserved for unassigned work.
 */

/** Five distinct, non-red hues. Muted enough for the CRM palette, far enough apart to tell apart. */
export const TECH_PALETTE = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#0d9488", // teal
  "#d97706", // amber
  "#c026d3", // fuchsia
] as const;

/** Deterministic string hash (djb2). Same input → same index, no randomness. */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

/** The technician's stable colour. Empty/unknown ids fall to the first hue. */
export function techColor(userId: string | undefined): string {
  if (!userId) return TECH_PALETTE[0];
  return TECH_PALETTE[hash(userId) % TECH_PALETTE.length];
}
