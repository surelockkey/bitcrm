import { describe, it, expect } from "vitest";
import { ServiceAreaType } from "@bitcrm/types";
import { serviceAreaFormSchema, toServiceAreaBody } from "./schemas";

const baseZip = {
  name: "Atlanta",
  priority: 0,
  active: true,
  type: ServiceAreaType.ZIPS,
  zips: [{ zip: "30301", radiusMiles: 10 }],
  vertices: [],
};

describe("serviceAreaFormSchema", () => {
  it("accepts a valid ZIP area", () => {
    const r = serviceAreaFormSchema.safeParse(baseZip);
    expect(r.success).toBe(true);
  });

  it("requires a name", () => {
    const r = serviceAreaFormSchema.safeParse({ ...baseZip, name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a ZIP area with no zips", () => {
    const r = serviceAreaFormSchema.safeParse({ ...baseZip, zips: [] });
    expect(r.success).toBe(false);
  });

  it("coerces an empty radius to undefined", () => {
    const r = serviceAreaFormSchema.safeParse({
      ...baseZip,
      zips: [{ zip: "30301", radiusMiles: "" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.zips[0].radiusMiles).toBeUndefined();
  });

  it("rejects a polygon with fewer than 3 vertices", () => {
    const r = serviceAreaFormSchema.safeParse({
      name: "Poly",
      priority: 0,
      active: true,
      type: ServiceAreaType.POLYGON,
      zips: [],
      vertices: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a polygon with 3+ vertices", () => {
    const r = serviceAreaFormSchema.safeParse({
      name: "Poly",
      priority: 2,
      active: true,
      type: ServiceAreaType.POLYGON,
      zips: [],
      vertices: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }],
    });
    expect(r.success).toBe(true);
  });
});

describe("toServiceAreaBody", () => {
  it("emits zips for a ZIP area (no vertices)", () => {
    const parsed = serviceAreaFormSchema.parse(baseZip);
    const body = toServiceAreaBody(parsed);
    expect(body).toMatchObject({ name: "Atlanta", type: ServiceAreaType.ZIPS });
    expect(body).toHaveProperty("zips");
    expect(body).not.toHaveProperty("vertices");
  });

  it("emits vertices for a polygon area (no zips)", () => {
    const parsed = serviceAreaFormSchema.parse({
      name: "Poly",
      priority: 0,
      active: true,
      type: ServiceAreaType.POLYGON,
      zips: [],
      vertices: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }],
    });
    const body = toServiceAreaBody(parsed);
    expect(body).toHaveProperty("vertices");
    expect(body).not.toHaveProperty("zips");
  });
});
