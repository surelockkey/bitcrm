import { FAR_FROM_ADDRESS_METERS, timelineLocationDetails } from 'src/deals/location-details';

/**
 * Where the technician's phone was when they changed a job's status or said
 * they arrived (owner, 2026-10-15): the fix, how far it was from the job's
 * address, and whether that is too far to have been done at the door.
 */
describe('timelineLocationDetails', () => {
  /** One degree of latitude on the mean Earth sphere, in metres. */
  const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180;
  const address = { lat: 41.7637, lng: -72.6851 };
  /** A fix `metres` due north of the job's address. */
  const north = (metres: number, accuracy?: number) => ({
    lat: address.lat + metres / M_PER_DEG_LAT,
    lng: address.lng,
    ...(accuracy !== undefined ? { accuracy } : {}),
  });

  it('is 500 m — the line between "at the job" and "far from it"', () => {
    expect(FAR_FROM_ADDRESS_METERS).toBe(500);
  });

  it('records the fix and its whole-metre distance from the address', () => {
    const fix = north(120.4, 8);

    expect(timelineLocationDetails(fix, address)).toEqual({
      location: { lat: fix.lat, lng: fix.lng, accuracy: 8 },
      distanceM: 120,
      farFromAddress: false,
    });
  });

  it('is not far at exactly 500 m, and far one metre past it', () => {
    expect(timelineLocationDetails(north(500), address)).toMatchObject({ distanceM: 500, farFromAddress: false });
    expect(timelineLocationDetails(north(501), address)).toMatchObject({ distanceM: 501, farFromAddress: true });
  });

  it('measures kilometres the same way — a close made 14 km away is far', () => {
    expect(timelineLocationDetails(north(14_200), address)).toMatchObject({ distanceM: 14_200, farFromAddress: true });
  });

  it('keeps the fix without a distance when the address has no coordinates', () => {
    const fix = north(50);

    for (const noCoords of [undefined, {}, { lat: 41.7 }, { lat: undefined, lng: undefined }]) {
      expect(timelineLocationDetails(fix, noCoords)).toEqual({ location: { lat: fix.lat, lng: fix.lng } });
    }
  });

  it('adds nothing when the phone sent no fix — the entry stays as it was', () => {
    expect(timelineLocationDetails(undefined, address)).toEqual({});
  });

  it('writes a plain object even when handed a validated DTO instance', () => {
    class Fix {
      constructor(public lat: number, public lng: number) {}
    }
    const { location } = timelineLocationDetails(new Fix(address.lat, address.lng), address) as { location: object };

    expect(Object.getPrototypeOf(location)).toBe(Object.prototype);
  });
});
