import {
  contrastRatio,
  darkColors,
  lightColors,
  relativeLuminance,
  touch,
  type ThemeColors,
} from './tokens';

/**
 * These are not style tests. A technician reads this screen outdoors, so the
 * palette carries a contract (docs/ARCHITECTURE.md §2.9) and the suite is where
 * that contract is enforced: soften a grey and a test goes red.
 */

const schemes: [string, ThemeColors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe('relativeLuminance', () => {
  it('bottoms out at black and tops out at white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('gives black-on-white the maximum ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    // Order must not matter — the ratio is symmetric.
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });
});

describe.each(schemes)('%s palette', (_name, c) => {
  const grounds = [c.background, c.surface, c.surfaceSunken];

  it('paints body text at AAA (7:1) on every ground it can land on', () => {
    for (const ground of grounds) {
      expect(contrastRatio(c.text, ground)).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps even the muted text at AAA — labels are read in the sun too', () => {
    for (const ground of grounds) {
      expect(contrastRatio(c.textMuted, ground)).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps accent text legible (4.5:1) on every ground', () => {
    for (const accent of [c.primary, c.danger, c.success, c.warning]) {
      for (const ground of grounds) {
        expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the label on a filled button legible', () => {
    for (const fill of [c.primary, c.danger, c.success]) {
      expect(contrastRatio(c.onAccent, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps accent text legible on its own soft tint', () => {
    const pairs: [string, string][] = [
      [c.primary, c.primarySoft],
      [c.danger, c.dangerSoft],
      [c.success, c.successSoft],
      [c.warning, c.warningSoft],
    ];
    for (const [ink, tint] of pairs) {
      expect(contrastRatio(ink, tint)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('separates the card from the page it sits on', () => {
    expect(c.surface).not.toBe(c.background);
    expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(1.4);
  });
});

describe('touch targets', () => {
  it('clears both platform minimums, with room for a glove', () => {
    expect(touch.min).toBeGreaterThanOrEqual(48); // Android 48 dp, Apple 44 pt
    expect(touch.primary).toBeGreaterThanOrEqual(touch.min);
    expect(touch.gap).toBeGreaterThanOrEqual(12);
  });
});
