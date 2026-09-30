import { describe, expect, it } from "vitest";
import type { BusinessProfileView } from "@bitcrm/types";
import { activeCompanies, defaultCompany, pickPrefillCompanyId } from "./lib";

const co = (over: Partial<BusinessProfileView>): BusinessProfileView =>
  ({
    id: "x",
    name: "X",
    isDefault: false,
    active: true,
    defaultPaymentTerms: "cash",
    dueDateBasis: "invoice_created",
    ...over,
  }) as BusinessProfileView;

const list = [
  co({ id: "b", name: "Beta" }),
  co({ id: "old", name: "Old", active: false }),
  co({ id: "a", name: "Alpha", isDefault: true }),
];

describe("company lib", () => {
  it("active companies: default first, then by name", () => {
    expect(activeCompanies(list).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("finds the default (falls back to the first active)", () => {
    expect(defaultCompany(list)?.id).toBe("a");
    expect(defaultCompany([co({ id: "z", active: false }), co({ id: "y" })])?.id).toBe("y");
    expect(defaultCompany(undefined)).toBeUndefined();
  });

  it("new-job prefill: query param → area default → account default", () => {
    expect(pickPrefillCompanyId({ queryId: "b", areaDefaultId: "old", companies: list })).toBe("b");
    expect(pickPrefillCompanyId({ areaDefaultId: "b", companies: list })).toBe("b");
    expect(pickPrefillCompanyId({ companies: list })).toBe("a");
    // An archived/unknown area default is skipped.
    expect(pickPrefillCompanyId({ areaDefaultId: "old", companies: list })).toBe("a");
    expect(pickPrefillCompanyId({ areaDefaultId: "gone", companies: list })).toBe("a");
    expect(pickPrefillCompanyId({ companies: undefined })).toBeUndefined();
  });

  it("keeps a query-param id even before the list loads", () => {
    expect(pickPrefillCompanyId({ queryId: "q1", companies: undefined })).toBe("q1");
  });
});
