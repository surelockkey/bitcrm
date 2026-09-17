import {
  distanceMetres,
  shouldKeepPoint,
  HEARTBEAT_INTERVAL_MS,
  MIN_SAMPLE_INTERVAL_MS,
  MOVE_THRESHOLD_METRES,
  type TrackSample,
} from '../../../../src/technicians/location/technician-location.util';

const BASE = '2026-09-17T08:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(BASE) + ms).toISOString();

const ATLANTA = { lat: 33.749, lng: -84.388 };
// ~0.001° of latitude is ~111 m — just over the move threshold.
const ONE_BLOCK_NORTH = { lat: 33.75, lng: -84.388 };
const ACROSS_THE_ROOM = { lat: 33.74901, lng: -84.388 };

function kept(over?: Partial<TrackSample>): TrackSample {
  return { ...ATLANTA, at: BASE, ...over };
}

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres(ATLANTA, ATLANTA)).toBe(0);
  });

  it('measures a degree of latitude as ~111 km', () => {
    const d = distanceMetres(ATLANTA, { lat: 34.749, lng: -84.388 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('measures a block as ~111 m', () => {
    expect(distanceMetres(ATLANTA, ONE_BLOCK_NORTH)).toBeGreaterThan(MOVE_THRESHOLD_METRES);
    expect(distanceMetres(ATLANTA, ONE_BLOCK_NORTH)).toBeLessThan(120);
  });
});

describe('shouldKeepPoint', () => {
  it('keeps the first fix, so a trail never starts halfway', () => {
    expect(shouldKeepPoint(null, ATLANTA, BASE)).toBe(true);
  });

  // The phone reports every few seconds; this is the rule that stops those
  // becoming ~10 000 rows a day each.
  it('drops anything inside the minimum interval, however far it moved', () => {
    const justUnder = at(MIN_SAMPLE_INTERVAL_MS - 1);
    expect(shouldKeepPoint(kept(), { lat: 34.749, lng: -84.388 }, justUnder)).toBe(false);
  });

  it('keeps a fix a minute later once he has moved 100 m', () => {
    expect(shouldKeepPoint(kept(), ONE_BLOCK_NORTH, at(MIN_SAMPLE_INTERVAL_MS))).toBe(true);
  });

  it('drops a fix a minute later when he has barely moved (GPS drift on a driveway)', () => {
    expect(shouldKeepPoint(kept(), ACROSS_THE_ROOM, at(MIN_SAMPLE_INTERVAL_MS))).toBe(false);
  });

  // A gap in the trail reads like the app died; a heartbeat says "still here".
  it('keeps a heartbeat for a van that has not moved in five minutes', () => {
    expect(shouldKeepPoint(kept(), ACROSS_THE_ROOM, at(HEARTBEAT_INTERVAL_MS))).toBe(true);
  });

  it('keeps the fix if the marker is stamped in the future (clock jumped back)', () => {
    expect(shouldKeepPoint(kept({ at: at(600_000) }), ATLANTA, BASE)).toBe(true);
  });
});
