import { describe, it, expect } from "vitest";
import type { ExternalCompany } from "@bitcrm/types";
import {
  externalCompanyName,
  externalCompanyNameMap,
  activeExternalCompanies,
  searchExternalCompanies,
  sortExternalCompanies,
} from "./lib";

const co = (over: Partial<ExternalCompany>): ExternalCompany => ({
  id: "ec-1",
  name: "Agero",
  active: true,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const catalog = [
  co({ id: "ec-1", name: "Agero" }),
  co({
    id: "ec-2",
    name: "Allied Dispatch Solutions",
    email: "Tammy.Killen@allieddispatch.com",
    address: "500 Borla Dr, Johnson City, TN 37604",
    phone: "(855) 281-0219",
    active: false,
  }),
  co({ id: "ec-3", name: "Yelp" }),
];

describe("externalCompanyName", () => {
  it("resolves an id to its name", () => {
    expect(externalCompanyName("ec-2", catalog)).toBe("Allied Dispatch Solutions");
  });
  it("falls back to the raw id for an unknown company", () => {
    expect(externalCompanyName("ec-x", catalog)).toBe("ec-x");
  });
  it("renders a dash for a missing id", () => {
    expect(externalCompanyName(undefined, catalog)).toBe("—");
  });
  it("builds a lookup map", () => {
    expect(externalCompanyNameMap(catalog).get("ec-1")).toBe("Agero");
  });
});

describe("activeExternalCompanies", () => {
  it("keeps only enabled companies, sorted by name", () => {
    expect(activeExternalCompanies(catalog).map((c) => c.name)).toEqual(["Agero", "Yelp"]);
  });
  it("tolerates an undefined catalog", () => {
    expect(activeExternalCompanies(undefined)).toEqual([]);
  });
});

describe("searchExternalCompanies", () => {
  it("returns everything for a blank query, sorted by name", () => {
    expect(searchExternalCompanies(catalog, "  ").map((c) => c.id)).toEqual([
      "ec-1",
      "ec-2",
      "ec-3",
    ]);
  });

  it("matches on name, email and address, case-insensitively", () => {
    expect(searchExternalCompanies(catalog, "allied").map((c) => c.id)).toEqual(["ec-2"]);
    expect(searchExternalCompanies(catalog, "TAMMY").map((c) => c.id)).toEqual(["ec-2"]);
    expect(searchExternalCompanies(catalog, "johnson city").map((c) => c.id)).toEqual(["ec-2"]);
  });

  it("matches a phone in any format or fragment", () => {
    for (const q of ["(855) 281-0219", "8552810219", "855 281 0219", "2810219", "0219"]) {
      expect(searchExternalCompanies(catalog, q).map((c) => c.id), q).toEqual(["ec-2"]);
    }
  });

  it("returns nothing when nothing matches", () => {
    expect(searchExternalCompanies(catalog, "zzzz")).toEqual([]);
  });
});

/**
 * Workiz's companies grid (DataTables) sorts on a header click: by name
 * first, any column either way, blanks last.
 */
describe("sortExternalCompanies", () => {
  it("sorts by the column, either way, case-blind", () => {
    const names = (sort: Parameters<typeof sortExternalCompanies>[1]) =>
      sortExternalCompanies(catalog, sort).map((c) => c.name);
    expect(names({ key: "name", dir: "asc" })).toEqual(["Agero", "Allied Dispatch Solutions", "Yelp"]);
    expect(names({ key: "name", dir: "desc" })).toEqual(["Yelp", "Allied Dispatch Solutions", "Agero"]);
  });

  it("puts companies without the value last, whichever way", () => {
    const by = (dir: "asc" | "desc") => sortExternalCompanies(catalog, { key: "email", dir }).map((c) => c.id);
    expect(by("asc")[0]).toBe("ec-2");
    expect(by("desc")[0]).toBe("ec-2");
  });

  it("sorts the status as Workiz prints it (Disabled before Enabled)", () => {
    const first = sortExternalCompanies(catalog, { key: "status", dir: "asc" })[0];
    expect(first.active).toBe(false);
  });

  it("leaves the list alone", () => {
    const copy = [...catalog];
    sortExternalCompanies(catalog, { key: "name", dir: "desc" });
    expect(catalog).toEqual(copy);
  });
});
