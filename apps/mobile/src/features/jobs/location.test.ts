import * as Location from 'expo-location';
import {
  currentPosition,
  GEOLOCATION_TIMEOUT_MS,
  MAX_REPORTED_ACCURACY_M,
  reportableAccuracy,
  toFix,
} from './location';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const mocked = Location as jest.Mocked<typeof Location>;

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

describe('currentPosition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers with the fix when the phone is quick about it', async () => {
    mocked.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 41.76, longitude: -72.67, accuracy: 9 },
    } as never);

    await expect(currentPosition()).resolves.toEqual({
      lat: 41.76,
      lng: -72.67,
      accuracy: 9,
    });
  });

  it('gives up after eight seconds rather than holding up an arrival', async () => {
    mocked.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}) as never);

    const pending = currentPosition();
    await Promise.resolve();
    jest.advanceTimersByTime(GEOLOCATION_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
  });

  it('survives a reading that rejects AFTER the timeout has already won', async () => {
    // The try/catch is long past by then. Without a catch on the reading
    // itself this is an unhandled rejection, and a red box in dev.
    let fail: (e: Error) => void = () => {};
    mocked.getCurrentPositionAsync.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }) as never,
    );
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const pending = currentPosition();
    await Promise.resolve();
    jest.advanceTimersByTime(GEOLOCATION_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();

    fail(new Error('Location permission revoked'));
    await Promise.resolve();
    await Promise.resolve();

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('records the arrival anyway when permission is refused', async () => {
    mocked.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);

    await expect(currentPosition()).resolves.toBeUndefined();
    expect(mocked.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
