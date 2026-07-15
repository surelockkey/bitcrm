import type { Address } from "@bitcrm/types";

/** The human-readable half of an address — everything except the coordinates. */
type AddressText = Omit<Address, "lat" | "lng">;

const EARTH_RADIUS_MILES = 3959;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Haversine. Mirrors `backend/services/deal/src/common/utils/haversine.ts`. */
export function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Can this be plotted? Explicitly not a truthiness check — lat/lng of 0 are the
 * equator and the prime meridian, and `if (lat && lng)` would drop them.
 */
export function hasCoords(
  address: { lat?: number; lng?: number } | undefined,
): address is { lat: number; lng: number } {
  return address?.lat !== undefined && address?.lng !== undefined;
}

const normalize = (value?: string) => (value ?? "").trim().toLowerCase();

/** Do two addresses describe the same place, ignoring case and padding? */
export function sameAddress(a: AddressText, b: AddressText): boolean {
  return (
    normalize(a.street) === normalize(b.street) &&
    normalize(a.unit) === normalize(b.unit) &&
    normalize(a.city) === normalize(b.city) &&
    normalize(a.state) === normalize(b.state) &&
    normalize(a.zip) === normalize(b.zip)
  );
}

/**
 * The address to PUT, with its coordinates settled.
 *
 * The backend writes `address` as one whole object, so whatever this omits is
 * erased. An unedited address must therefore carry its stored coordinates
 * forward — otherwise saving an untouched deal wipes them and its pin vanishes
 * from the dispatch map. An edited address must instead arrive *without*
 * coordinates, so the backend re-geocodes rather than leaving the pin at the
 * old house. Coordinates the form supplies itself (address autocomplete) always win.
 */
export function addressForSubmit(next: Address, previous?: Address): Address {
  const unit = next.unit?.trim() ? next.unit.trim() : undefined;
  const address: Address = { ...next, unit };

  if (hasCoords(address)) return address;

  if (previous && hasCoords(previous) && sameAddress(previous, address)) {
    return { ...address, lat: previous.lat, lng: previous.lng };
  }

  return { ...address, lat: undefined, lng: undefined };
}
