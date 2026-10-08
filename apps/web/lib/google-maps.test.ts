import { describe, expect, it } from "vitest";
import { parsePlace } from "./google-maps";

const component = (long_name: string, short_name: string, ...types: string[]) => ({ long_name, short_name, types });

describe("parsePlace", () => {
  it("reads street, city, state code, zip, the country code and the point", () => {
    const parsed = parsePlace({
      address_components: [
        component("12", "12", "street_number"),
        component("Main Street", "Main St", "route"),
        component("Toronto", "Toronto", "locality"),
        component("Ontario", "ON", "administrative_area_level_1"),
        component("Canada", "CA", "country", "political"),
        component("M5V 2T6", "M5V 2T6", "postal_code"),
      ],
      geometry: { location: { lat: () => 43.6, lng: () => -79.4 } },
    });
    expect(parsed).toEqual({
      street: "12 Main Street",
      city: "Toronto",
      state: "ON",
      zip: "M5V 2T6",
      country: "CA",
      lat: 43.6,
      lng: -79.4,
    });
  });

  it("leaves the country out when Google gives none", () => {
    expect(parsePlace({ address_components: [] })).not.toHaveProperty("country");
  });
});
