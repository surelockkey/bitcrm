import { describe, it, expect } from "vitest";
import { ServiceAreaType, type ServiceArea } from "@bitcrm/types";
import { describeArea, coverageCenter, circleToPath } from "./lib";

function area(overrides: Partial<ServiceArea>): ServiceArea {
  return {
    id: "a1",
    name: "Test",
    priority: 0,
    active: true,
    type: ServiceAreaType.ZIPS,
    definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: "30301" }] },
    coverage: [{ kind: "circle", lat: 33.75, lng: -84.39, radiusMiles: 3 }],
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("describeArea", () => {
  it("summarizes a single ZIP with radius", () => {
    const a = area({ definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: "30301", radiusMiles: 10 }] } });
    expect(describeArea(a)).toBe("ZIP 30301 + 10 mi");
  });

  it("summarizes a single ZIP without radius", () => {
    expect(describeArea(area({}))).toBe("ZIP 30301");
  });

  it("summarizes a ZIP list", () => {
    const a = area({ definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: "1" }, { zip: "2" }] } });
    expect(describeArea(a)).toBe("2 ZIP codes");
  });

  it("summarizes a polygon", () => {
    const a = area({
      type: ServiceAreaType.POLYGON,
      definition: { type: ServiceAreaType.POLYGON, vertices: [
        { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 },
      ] },
    });
    expect(describeArea(a)).toBe("Polygon · 3 points");
  });
});

describe("coverageCenter", () => {
  it("averages circle centers", () => {
    const c = coverageCenter([
      { kind: "circle", lat: 0, lng: 0, radiusMiles: 1 },
      { kind: "circle", lat: 2, lng: 4, radiusMiles: 1 },
    ]);
    expect(c).toEqual({ lat: 1, lng: 2 });
  });

  it("returns null for empty coverage", () => {
    expect(coverageCenter([])).toBeNull();
  });
});

describe("circleToPath", () => {
  it("produces a closed ring of the requested resolution", () => {
    const path = circleToPath(33.75, -84.39, 5, 12);
    expect(path).toHaveLength(12);
    // All points sit at roughly the same distance from center (a circle).
    for (const p of path) {
      expect(Math.abs(p.lat - 33.75)).toBeLessThan(0.1);
    }
  });
});
