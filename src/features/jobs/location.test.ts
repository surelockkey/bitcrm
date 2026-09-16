import {
  MAX_REPORTED_ACCURACY_M,
  reportableAccuracy,
  toFix,
} from './location';

describe('reportableAccuracy', () => {
  it('accepts a real GPS radius', () => {
    expect(reportableAccuracy(0)).toBe(true);
    expect(reportableAccuracy(12.5)).toBe(true);
    expect(reportableAccuracy(MAX_REPORTED_ACCURACY_M)).toBe(true);
  });

  it('drops a radius the server would reject outright', () => {
    // A network-derived fix can claim hundreds of kilometres. The arrival
    // matters; the annotation does not — so the annotation goes, not the 202.
    expect(reportableAccuracy(MAX_REPORTED_ACCURACY_M + 1)).toBe(false);
    expect(reportableAccuracy(-1)).toBe(false);
  });

  it('drops a missing or nonsense reading', () => {
    expect(reportableAccuracy(undefined)).toBe(false);
    expect(reportableAccuracy(null)).toBe(false);
    expect(reportableAccuracy(Number.NaN)).toBe(false);
    expect(reportableAccuracy(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('toFix', () => {
  it('renames the phone’s fields to the ones the server takes', () => {
    expect(toFix({ latitude: 41.76, longitude: -72.67, accuracy: 8 })).toEqual({
      lat: 41.76,
      lng: -72.67,
      accuracy: 8,
    });
  });

  it('omits accuracy entirely rather than sending something invalid', () => {
    expect(toFix({ latitude: 41.76, longitude: -72.67, accuracy: 999_999 })).toEqual({
      lat: 41.76,
      lng: -72.67,
    });
    expect(toFix({ latitude: 41.76, longitude: -72.67 })).toEqual({
      lat: 41.76,
      lng: -72.67,
    });
  });
});
