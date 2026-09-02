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

/**
 * `toServiceAreaBody` is a whitelist, and deal-service runs a whitelisting
 * ValidationPipe on the other end. A field missing from either one never
 * arrives, with no error at any layer — so the market number needs a guard at
 * both ends of the wire.
 */
describe("market caller id", () => {
  const zipForm = {
    name: "Atlanta",
    priority: 0,
    active: true,
    type: ServiceAreaType.ZIPS,
    zips: [{ zip: "30301" }],
    vertices: [],
  };

  it("carries the number into the request body", () => {
    const body = toServiceAreaBody(
      serviceAreaFormSchema.parse({ ...zipForm, callerId: "+14045550100" }),
    );
    expect(body).toMatchObject({ callerId: "+14045550100" });
  });

  it("sends an empty string to clear it", () => {
    const body = toServiceAreaBody(
      serviceAreaFormSchema.parse({ ...zipForm, callerId: "" }),
    );
    expect(body).toMatchObject({ callerId: "" });
  });

  it("defaults to empty when the form omits it", () => {
    const body = toServiceAreaBody(serviceAreaFormSchema.parse(zipForm));
    expect(body).toMatchObject({ callerId: "" });
  });

  it("carries it on a polygon area too", () => {
    const body = toServiceAreaBody(
      serviceAreaFormSchema.parse({
        ...zipForm,
        type: ServiceAreaType.POLYGON,
        zips: [],
        vertices: [
          { lat: 33.7, lng: -84.3 },
          { lat: 33.8, lng: -84.3 },
          { lat: 33.8, lng: -84.4 },
        ],
        callerId: "+14045550100",
      }),
    );
    expect(body).toMatchObject({ callerId: "+14045550100" });
  });
});
