import { env } from "@/lib/env";

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
    __bitcrmGmapsCb?: () => void;
  }
}

let loader: Promise<GoogleMaps | null> | null = null;

/**
 * Lazily load the Google Maps JS API (Places library). Resolves to the loaded
 * `google` global, or `null` when no API key is configured or loading fails —
 * callers should then fall back to manual entry.
 */
export function loadGoogleMaps(): Promise<GoogleMaps | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (!env.googleMapsApiKey) return Promise.resolve(null);
  if (loader) return loader;

  loader = new Promise((resolve) => {
    window.__bitcrmGmapsCb = () => resolve(window.google ?? null);
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: env.googleMapsApiKey,
      libraries: "places",
      loading: "async",
      callback: "__bitcrmGmapsCb",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loader;
}

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
