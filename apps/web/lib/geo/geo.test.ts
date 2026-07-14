import { describe, expect, it } from "vitest";
import { distanceMiles, hasCoords, addressForSubmit, sameAddress } from "./geo";

// The same fixtures the backend haversine tests use.
const ATLANTA = { lat: 33.749, lng: -84.388 };
const MARIETTA = { lat: 33.9526, lng: -84.5499 };

describe("distanceMiles", () => {
  it("measures a known distance (Atlanta → Marietta ≈ 16 mi)", () => {
    const miles = distanceMiles(ATLANTA.lat, ATLANTA.lng, MARIETTA.lat, MARIETTA.lng);
    expect(miles).toBeGreaterThan(14);
    expect(miles).toBeLessThan(18);
  });

  it("is zero for the same point", () => {
    expect(distanceMiles(ATLANTA.lat, ATLANTA.lng, ATLANTA.lat, ATLANTA.lng)).toBe(0);
  });

  it("is symmetric", () => {
    const there = distanceMiles(ATLANTA.lat, ATLANTA.lng, MARIETTA.lat, MARIETTA.lng);
    const back = distanceMiles(MARIETTA.lat, MARIETTA.lng, ATLANTA.lat, ATLANTA.lng);
    expect(there).toBeCloseTo(back, 6);
  });
});

describe("hasCoords", () => {
  it("accepts an address with both coordinates", () => {
    expect(hasCoords({ lat: 33.749, lng: -84.388 })).toBe(true);
  });

  it("rejects a half-located address", () => {
    expect(hasCoords({ lat: 33.749 })).toBe(false);
    expect(hasCoords({ lng: -84.388 })).toBe(false);
    expect(hasCoords({})).toBe(false);
    expect(hasCoords(undefined)).toBe(false);
  });

  // The equator and the prime meridian are real places; a truthiness check
  // would drop them off the map.
  it("accepts zero coordinates", () => {
    expect(hasCoords({ lat: 0, lng: 0 })).toBe(true);
  });
});

const STORED = {
  street: "123 Peachtree St",
  city: "Atlanta",
  state: "GA",
  zip: "30303",
  lat: 33.749,
  lng: -84.388,
};

describe("sameAddress", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(
      sameAddress(STORED, {
        street: "  123 PEACHTREE st ",
        city: "atlanta",
        state: "ga",
        zip: "30303",
      }),
    ).toBe(true);
  });

  it("treats a missing unit and an empty unit as the same", () => {
    expect(sameAddress(STORED, { ...STORED, unit: "" })).toBe(true);
  });

  it("sees a changed street", () => {
    expect(sameAddress(STORED, { ...STORED, street: "999 Elsewhere Rd" })).toBe(false);
  });

  it("sees a changed unit", () => {
    expect(sameAddress(STORED, { ...STORED, unit: "Apt 4" })).toBe(false);
  });
});

describe("addressForSubmit", () => {
  it("keeps the stored coordinates when the address text is unchanged", () => {
    const result = addressForSubmit(
      { street: "123 Peachtree St", city: "Atlanta", state: "GA", zip: "30303" },
      STORED,
    );

    expect(result.lat).toBe(33.749);
    expect(result.lng).toBe(-84.388);
  });

  // Stale coordinates would leave the pin at the old house. Sending none lets
  // the backend re-geocode.
  it("drops the coordinates when the address text changed", () => {
    const result = addressForSubmit(
      { street: "999 Elsewhere Rd", city: "Atlanta", state: "GA", zip: "30303" },
      STORED,
    );

    expect(result.lat).toBeUndefined();
    expect(result.lng).toBeUndefined();
    expect(result.street).toBe("999 Elsewhere Rd");
  });

  it("honours coordinates the form supplies itself (address autocomplete)", () => {
    const result = addressForSubmit(
      { street: "999 Elsewhere Rd", city: "Atlanta", state: "GA", zip: "30303", lat: 40, lng: -70 },
      STORED,
    );

    expect(result.lat).toBe(40);
    expect(result.lng).toBe(-70);
  });

  it("has nothing to carry when the deal was never located", () => {
    const result = addressForSubmit(
      { street: "123 Peachtree St", city: "Atlanta", state: "GA", zip: "30303" },
      { street: "123 Peachtree St", city: "Atlanta", state: "GA", zip: "30303" },
    );

    expect(result.lat).toBeUndefined();
  });

  it("normalises an empty unit away so it does not reach the API", () => {
    const result = addressForSubmit(
      { street: "123 Peachtree St", unit: "", city: "Atlanta", state: "GA", zip: "30303" },
      STORED,
    );

    expect(result.unit).toBeUndefined();
  });
});
