/**
 * A technician's own colour, the way Workiz gives each one a chip you learn to
 * recognise. It comes from the id rather than being stored, so the same person
 * is the same colour on every screen and on every machine, for ever, with
 * nothing to configure and nothing to migrate.
 */

/** Solid chips, dark enough for white text in both themes. */
const PALETTE = [
  "bg-orange-500",
  "bg-pink-500",
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-teal-600",
  "bg-rose-600",
  "bg-indigo-600",
  "bg-lime-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
] as const;

export function techColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
