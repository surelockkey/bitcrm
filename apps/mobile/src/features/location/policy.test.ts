import {
  distanceMeters,
  HEARTBEAT_MS,
  MIN_SEND_INTERVAL_MS,
  MOVED_DISTANCE_M,
  shouldSendFix,
  toLocationPoint,
  type LastSent,
} from './policy';

const hartford = { lat: 41.7637, lng: -72.6851 };

/** A point `metres` north of another — latitude only, so the maths is simple. */
const north = (from: { lat: number; lng: number }, metres: number) => ({
  lat: from.lat + metres / 111_320,
  lng: from.lng,
});

describe('distanceMeters', () => {
  it('measures in metres, which is the unit this decision is made in', () => {
    expect(distanceMeters(hartford, hartford)).toBe(0);
    expect(distanceMeters(hartford, north(hartford, 100))).toBeCloseTo(100, 0);
  });

  it('handles a van that crossed a degree of longitude', () => {
    const far = { lat: 41.7637, lng: -71.6851 };
    // Roughly 83 km at this latitude — the point is that it is not nonsense.
    expect(distanceMeters(hartford, far)).toBeGreaterThan(80_000);
    expect(distanceMeters(hartford, far)).toBeLessThan(86_000);
  });
});

describe('shouldSendFix', () => {
  const sent = (at: number, point = hartford): LastSent => ({ point, at });

  it('always sends the first fix of a shift', () => {
    // Until it lands, dispatch has no pin at all — and a technician who has
    // just clocked in is the one they are looking for.
    expect(shouldSendFix(null, hartford, 1_000)).toBe(true);
  });

  it('never sends twice inside the floor, however much the reading jumps', () => {
    // A poor fix on a doorstep jitters by a hundred metres; without the floor
    // it would post continuously.
    const far = north(hartford, 5_000);
    expect(shouldSendFix(sent(0), far, MIN_SEND_INTERVAL_MS - 1)).toBe(false);
  });

  it('sends as soon as the floor allows once the technician has moved', () => {
    const moved = north(hartford, MOVED_DISTANCE_M + 10);
    expect(shouldSendFix(sent(0), moved, MIN_SEND_INTERVAL_MS)).toBe(true);
  });

  it('stays quiet for a technician standing still', () => {
    const shuffled = north(hartford, 5);
    expect(shouldSendFix(sent(0), shuffled, MIN_SEND_INTERVAL_MS)).toBe(false);
  });

  it('still beats every few minutes, so a stale pin means parked, not dead', () => {
    const shuffled = north(hartford, 5);
    expect(shouldSendFix(sent(0), shuffled, HEARTBEAT_MS)).toBe(true);
  });
});

describe('toLocationPoint', () => {
  it('keeps an accuracy the server will accept', () => {
    expect(
      toLocationPoint({ latitude: 41.7637, longitude: -72.6851, accuracy: 12 }),
    ).toEqual({ lat: 41.7637, lng: -72.6851, accuracy: 12 });
  });

  it('drops an accuracy the server would reject rather than losing the position', () => {
    // A network-derived fix can claim hundreds of kilometres. That number is an
    // annotation; the position it annotates is still worth sending.
    expect(
      toLocationPoint({ latitude: 41.7637, longitude: -72.6851, accuracy: 900_000 }),
    ).toEqual({ lat: 41.7637, lng: -72.6851 });
    expect(
      toLocationPoint({ latitude: 41.7637, longitude: -72.6851, accuracy: null }),
    ).toEqual({ lat: 41.7637, lng: -72.6851 });
  });

  it('throws away a reading the endpoint would 400 on', () => {
    // `SetLocationDto` bounds both, and a rejected request in the middle of a
    // shift is worse than a dropped reading nobody would have looked at.
    expect(toLocationPoint({ latitude: 200, longitude: 0 })).toBeNull();
    expect(toLocationPoint({ latitude: 0, longitude: -500 })).toBeNull();
    expect(toLocationPoint({ latitude: NaN, longitude: 0 })).toBeNull();
  });
});
