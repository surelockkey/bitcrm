import { describe, expect, it } from "vitest";
import type { QualifiedTech } from "../../api";
import {
  COUNTRIES,
  CA_PROVINCES,
  US_STATES,
  businessProfileOptions,
  catalogOptions,
  countryOptions,
  countryOf,
  externalCompanyOptions,
  serviceAreaOptions,
  serviceAreaValueLabel,
  stateCode,
  stateOptions,
  teamNotice,
  teamOptions,
} from "./options";

const area = (id: string, name: string, priority = 0, active = true) =>
  ({ id, name, priority, active }) as never;

describe("catalogOptions (job types, job sources)", () => {
  it("maps the active catalog to options, in the order given", () => {
    expect(
      catalogOptions([
        { id: "a", name: "Lockout" },
        { id: "b", name: "Rekey" },
      ]),
    ).toEqual([
      { value: "a", label: "Lockout" },
      { value: "b", label: "Rekey" },
    ]);
  });

  it("puts an archived current value first, marked, so an old job keeps its name", () => {
    expect(catalogOptions([{ id: "a", name: "Lockout" }], { id: "z", name: "Safe" })).toEqual([
      { value: "z", label: "Safe (archived)" },
      { value: "a", label: "Lockout" },
    ]);
  });

  it("ignores an archived entry that is somehow also active", () => {
    expect(catalogOptions([{ id: "a", name: "Lockout" }], { id: "a", name: "Lockout" })).toEqual([
      { value: "a", label: "Lockout" },
    ]);
  });
});

describe("externalCompanyOptions", () => {
  const all = [
    { id: "x1", name: "Zeta", active: true },
    { id: "x2", name: "Acme", active: true },
    { id: "x3", name: "Gone", active: false },
  ] as never;

  it("offers the active companies, sorted by name", () => {
    expect(externalCompanyOptions(all, undefined).map((o) => o.label)).toEqual(["Acme", "Zeta"]);
  });

  it("keeps a disabled company the job already points at, marked", () => {
    expect(externalCompanyOptions(all, "x3")[0]).toEqual({ value: "x3", label: "Gone (disabled)" });
  });
});

describe("businessProfileOptions", () => {
  const data = [
    { id: "b1", name: "SureLock", isDefault: true, active: true },
    { id: "b2", name: "KeyPro", isDefault: false, active: true },
    { id: "b3", name: "Old Co", isDefault: false, active: false },
  ] as never;
  const active = [
    { id: "b1", name: "SureLock", isDefault: true, active: true },
    { id: "b2", name: "KeyPro", isDefault: false, active: true },
  ] as never;

  it("labels the default company when asked", () => {
    expect(businessProfileOptions({ data, active, value: "b1", showDefaultHint: true })).toEqual([
      { value: "b1", label: "SureLock (default company)" },
      { value: "b2", label: "KeyPro" },
    ]);
  });

  it("keeps an archived selection, by its catalog name or the job's snapshot", () => {
    expect(businessProfileOptions({ data, active, value: "b3" })[0]).toEqual({
      value: "b3",
      label: "Old Co (archived)",
    });
    expect(
      businessProfileOptions({ data, active, value: "b9", fallbackName: "Snap Co" })[0],
    ).toEqual({ value: "b9", label: "Snap Co (archived)" });
  });

  it("names an unknown selection only once the catalog is in", () => {
    expect(businessProfileOptions({ data, active, value: "b9", loading: true })).toHaveLength(2);
    expect(businessProfileOptions({ data, active, value: "b9" })[0]).toEqual({
      value: "b9",
      label: "Unknown company (archived)",
    });
  });
});

describe("serviceAreaOptions", () => {
  it("offers active areas by priority, then name, plus the chosen one if inactive", () => {
    const areas = [area("1", "B", 0), area("2", "A", 0), area("3", "Top", 5), area("4", "Off", 9, false)];
    expect(serviceAreaOptions(areas, undefined).map((o) => o.label)).toEqual(["Top", "A", "B"]);
    expect(serviceAreaOptions(areas, "4").map((o) => o.label)).toEqual(["Off", "Top", "A", "B"]);
  });
});

describe("serviceAreaValueLabel — Workiz's 'SURE LOCK DALLAS TX (0 miles away)'", () => {
  const dallas = { id: "d", name: "SURE LOCK DALLAS TX" };

  it("an address inside the area is 0 miles away", () => {
    expect(
      serviceAreaValueLabel({ source: "resolved", area: dallas, resolvedArea: dallas } as never),
    ).toBe("SURE LOCK DALLAS TX (0 miles away)");
  });

  it("the nearest fallback says how far, rounded", () => {
    expect(
      serviceAreaValueLabel({ source: "nearest", area: dallas, distanceMiles: 12.6, resolvedArea: null } as never),
    ).toBe("SURE LOCK DALLAS TX (13 miles away)");
  });

  it("a hand pick is 0 miles away when the address is in it, otherwise just its name", () => {
    expect(
      serviceAreaValueLabel({ source: "manual", area: dallas, resolvedArea: dallas } as never),
    ).toBe("SURE LOCK DALLAS TX (0 miles away)");
    expect(
      serviceAreaValueLabel({ source: "manual", area: dallas, resolvedArea: { id: "x", name: "X" } } as never),
    ).toBe("SURE LOCK DALLAS TX");
  });

  it("nothing detected yet: no label", () => {
    expect(serviceAreaValueLabel({ source: null, area: null, resolvedArea: null } as never)).toBeUndefined();
  });
});

describe("states and countries", () => {
  it("has Workiz's 51 US entries (50 states + DC) and Canada's 13 provinces/territories", () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES).toContainEqual(["DC", "District of Columbia"]);
    expect(US_STATES[0]).toEqual(["AL", "Alabama"]);
    expect(CA_PROVINCES).toHaveLength(13);
    expect(CA_PROVINCES).toContainEqual(["ON", "Ontario"]);
  });

  it("offers the list that matches the country; none (free text) elsewhere", () => {
    expect(stateOptions("US")[43]).toEqual({ value: "TX", label: "Texas" });
    expect(stateOptions(undefined)).toHaveLength(51);
    expect(stateOptions("CA").map((o) => o.value)).toContain("QC");
    expect(stateOptions("GB")).toEqual([]);
  });

  it("normalises a state to its code: names, any case, codes", () => {
    expect(stateCode("Texas", "US")).toBe("TX");
    expect(stateCode("tx", "US")).toBe("TX");
    expect(stateCode(" new york ", undefined)).toBe("NY");
    expect(stateCode("Ontario", "CA")).toBe("ON");
    expect(stateCode("Greater London", "GB")).toBe("Greater London");
    expect(stateCode("", "US")).toBe("");
  });

  it("lists Workiz's 249 countries with ISO codes; the importer's US, CA and GB among them", () => {
    expect(COUNTRIES).toHaveLength(249);
    const opts = countryOptions();
    expect(opts).toContainEqual({ value: "US", label: "United States" });
    expect(opts).toContainEqual({ value: "CA", label: "Canada" });
    expect(opts).toContainEqual({ value: "GB", label: "United Kingdom" });
    expect(new Set(opts.map((o) => o.value)).size).toBe(249);
  });

  it("an address without a country is in the United States", () => {
    expect(countryOf(undefined)).toBe("US");
    expect(countryOf({ country: "" })).toBe("US");
    expect(countryOf({ country: "ca" })).toBe("CA");
  });
});

describe("team (Assign team members)", () => {
  const tech = (id: string, eligible: boolean, reasons: QualifiedTech["reasons"] = []): QualifiedTech => ({
    id,
    firstName: id.toUpperCase(),
    lastName: "Tech",
    eligible,
    reasons,
  });

  it("offers the eligible techs; the rest stay visible but disabled, with why", () => {
    const opts = teamOptions([tech("a", true), tech("b", false, ["outside_area"])], [], () => undefined);
    expect(opts).toEqual([
      { value: "a", label: "A Tech" },
      { value: "b", label: "B Tech (outside this service area)", disabled: true },
    ]);
  });

  it("keeps a picked tech that is not on the list, named from the directory", () => {
    const opts = teamOptions([tech("a", true)], ["z"], (id) => (id === "z" ? "Zoe Imported" : undefined));
    expect(opts).toContainEqual({ value: "z", label: "Zoe Imported" });
  });

  it("says Workiz's notice: no area yet, or how many techs can go", () => {
    expect(teamNotice({ hasArea: false })).toEqual({ kind: "no-area" });
    expect(teamNotice({ hasArea: true, areaName: "SURE LOCK DALLAS TX", count: 2 })).toEqual({
      kind: "count",
      count: 2,
      area: "SURE LOCK DALLAS TX",
      jobType: null,
    });
    expect(
      teamNotice({ hasArea: true, areaName: "SURE LOCK DALLAS TX", count: 25, jobTypeName: "Service" }),
    ).toMatchObject({ jobType: "Service" });
  });
});
