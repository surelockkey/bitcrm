/**
 * Minimal typings for the slice of the Google Maps Places API we use, so we
 * don't need the full @types/google.maps dependency.
 */
export interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text?: string;
  };
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface PlaceDetails {
  address_components?: AddressComponent[];
  geometry?: { location?: { lat: () => number; lng: () => number } };
}

interface GoogleMapsPlaces {
  AutocompleteService: new () => {
    getPlacePredictions: (
      req: { input: string; types?: string[]; componentRestrictions?: { country: string | string[] }; sessionToken?: unknown },
      cb: (predictions: PlacePrediction[] | null, status: string) => void,
    ) => void;
  };
  PlacesService: new (attrContainer: HTMLElement) => {
    getDetails: (
      req: { placeId: string; fields: string[]; sessionToken?: unknown },
      cb: (place: PlaceDetails | null, status: string) => void,
    ) => void;
  };
  AutocompleteSessionToken: new () => unknown;
  PlacesServiceStatus: { OK: string };
}

interface GoogleMaps {
  maps: { places: GoogleMapsPlaces };
}

declare global {
  interface Window {
    google?: GoogleMaps;
  }
}

// Maps is loaded by the shared @vis.gl provider (see components/maps/maps-provider),
// not a hand-injected script — a second loader makes Google warn about loading the
// API multiple times. This module keeps only the typings and the place parser.

/** Pull the fields we care about out of a Places details response. */
export function parsePlace(place: PlaceDetails): {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
} {
  const get = (type: string, short = false) => {
    const c = place.address_components?.find((a) => a.types.includes(type));
    return c ? (short ? c.short_name : c.long_name) : "";
  };
  const streetNumber = get("street_number");
  const route = get("route");
  const city = get("locality") || get("postal_town") || get("sublocality") || get("administrative_area_level_2");
  return {
    street: [streetNumber, route].filter(Boolean).join(" "),
    city,
    state: get("administrative_area_level_1", true),
    zip: get("postal_code"),
    lat: place.geometry?.location?.lat(),
    lng: place.geometry?.location?.lng(),
  };
}
