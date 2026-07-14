import type { Address } from "@bitcrm/types";

/**
 * One component of a Google place address.
 *
 * The Places API (New) returns `longText`/`shortText`; the legacy library
 * returns `long_name`/`short_name`. Both are accepted so a library swap can't
 * quietly start producing blank addresses.
 */
export interface PlaceAddressComponent {
  types: string[];
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
}

const long = (c: PlaceAddressComponent) => c.longText ?? c.long_name ?? "";
const short = (c: PlaceAddressComponent) => c.shortText ?? c.short_name ?? long(c);

function find(components: PlaceAddressComponent[], type: string) {
  return components.find((c) => c.types.includes(type));
}

/**
 * A Google place → our `Address`, coordinates included.
 *
 * Missing parts are left empty rather than guessed. A half-filled form the
 * dispatcher can see and correct beats one that silently drops the ZIP and
 * produces a deal that can never be plotted.
 */
export function parsePlace(
  components: PlaceAddressComponent[],
  location: { lat: number; lng: number },
): Address {
  const number = find(components, "street_number");
  const route = find(components, "route");
  const unit = find(components, "subpremise");

  // Some places are a borough rather than a city (Brooklyn, not New York).
  const city =
    find(components, "locality") ??
    find(components, "sublocality_level_1") ??
    find(components, "sublocality") ??
    find(components, "postal_town");

  const state = find(components, "administrative_area_level_1");
  const zip = find(components, "postal_code");

  const street = [number ? long(number) : "", route ? short(route) : ""]
    .filter(Boolean)
    .join(" ");

  return {
    street,
    unit: unit ? long(unit) : undefined,
    city: city ? long(city) : "",
    // The two-letter code — what the backend and service areas key on.
    state: state ? short(state) : "",
    zip: zip ? long(zip) : "",
    lat: location.lat,
    lng: location.lng,
  };
}
