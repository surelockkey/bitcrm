const EARTH_RADIUS_MILES = 3959;
/** The mean Earth radius — what a phone fix's distance from a job is measured on. */
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** The angle between two points as seen from the Earth's centre, in radians (haversine). */
function centralAngle(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return EARTH_RADIUS_MILES * centralAngle(lat1, lng1, lat2, lng2);
}

/** Great-circle distance in metres — how far a technician's phone was from a job's address. */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return EARTH_RADIUS_METERS * centralAngle(lat1, lng1, lat2, lng2);
}
