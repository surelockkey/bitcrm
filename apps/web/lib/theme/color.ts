/**
 * Colour maths for the design system.
 *
 * The palette is read off Workiz screenshots rather than chosen, so the job of
 * these two functions is to catch the places where a sampled colour cannot do
 * the job being asked of it — their orange is a fill, not a label colour.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `#aabbcc` -> the three 0–255 channels. */
function channels(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Undo the sRGB transfer curve for one 0–255 channel. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance: 0 for black, 1 for white.
 *
 * Not the average of the channels — green carries most of the perceived
 * brightness, which is why Workiz yellow reads as a light surface despite
 * having no blue in it at all.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white).
 * Order does not matter.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
