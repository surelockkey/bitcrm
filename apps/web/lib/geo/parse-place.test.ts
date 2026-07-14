import { describe, expect, it } from "vitest";
import { parsePlace, type PlaceAddressComponent } from "./parse-place";

/** The shape the Places API (New) returns: camelCase longText/shortText. */
function component(
  types: string[],
  longText: string,
  shortText = longText,
): PlaceAddressComponent {
  return { types, longText, shortText };
}

const ATLANTA = [
  component(["street_number"], "123"),
  component(["route"], "Peachtree Street Northeast", "Peachtree St NE"),
  component(["locality"], "Atlanta"),
  component(["administrative_area_level_1"], "Georgia", "GA"),
  component(["postal_code"], "30303"),
  component(["country"], "United States", "US"),
];

const LOCATION = { lat: 33.749, lng: -84.388 };

describe("parsePlace", () => {
  it("builds an address with coordinates from a Google place", () => {
    expect(parsePlace(ATLANTA, LOCATION)).toEqual({
      street: "123 Peachtree St NE",
      unit: undefined,
      city: "Atlanta",
      state: "GA",
      zip: "30303",
      lat: 33.749,
      lng: -84.388,
    });
  });

  // The state must be the two-letter code the backend and service areas use,
  // not "Georgia".
  it("takes the short form of the state", () => {
    expect(parsePlace(ATLANTA, LOCATION).state).toBe("GA");
  });

  it("picks up an apartment or suite as the unit", () => {
    const withUnit = [...ATLANTA, component(["subpremise"], "Apt 4B")];

    expect(parsePlace(withUnit, LOCATION).unit).toBe("Apt 4B");
  });

  it("handles a place with no street number (a named building)", () => {
    const noNumber = ATLANTA.filter((c) => !c.types.includes("street_number"));

    expect(parsePlace(noNumber, LOCATION).street).toBe("Peachtree St NE");
  });

  it("falls back to the sublocality when there is no locality", () => {
    const boroughs = [
      component(["street_number"], "1"),
      component(["route"], "Main St"),
      component(["sublocality", "sublocality_level_1"], "Brooklyn"),
      component(["administrative_area_level_1"], "New York", "NY"),
      component(["postal_code"], "11201"),
    ];

    expect(parsePlace(boroughs, LOCATION).city).toBe("Brooklyn");
  });

  // An address we cannot fill in is worse than no address: the dispatcher must
  // see the blanks rather than get a half-filled form that silently omits a ZIP.
  it("leaves missing parts empty rather than inventing them", () => {
    const sparse = [component(["route"], "Nowhere Rd")];

    expect(parsePlace(sparse, LOCATION)).toMatchObject({
      street: "Nowhere Rd",
      city: "",
      state: "",
      zip: "",
    });
  });

  it("still returns coordinates when the components are unusable", () => {
    expect(parsePlace([], LOCATION)).toMatchObject({ lat: 33.749, lng: -84.388 });
  });

  it("tolerates the legacy long_name/short_name shape", () => {
    const legacy = [
      { types: ["street_number"], long_name: "9", short_name: "9" },
      { types: ["route"], long_name: "Elm Street", short_name: "Elm St" },
      { types: ["locality"], long_name: "Marietta", short_name: "Marietta" },
      { types: ["administrative_area_level_1"], long_name: "Georgia", short_name: "GA" },
      { types: ["postal_code"], long_name: "30060", short_name: "30060" },
    ] as unknown as PlaceAddressComponent[];

    expect(parsePlace(legacy, LOCATION)).toMatchObject({
      street: "9 Elm St",
      city: "Marietta",
      state: "GA",
      zip: "30060",
    });
  });
});
