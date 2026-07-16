import { describe, it, expect } from "vitest";
import { LocationType, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import {
  transferTypeLabel,
  isAutoType,
  resolveEndpoint,
  filterByType,
} from "./lib";

const map = new Map<string, string>([
  ["w1", "Central Warehouse"],
  ["c1", "Riley Santos"],
]);

describe("type helpers", () => {
  it("labels types", () => {
    expect(transferTypeLabel(TransferType.RECEIVE)).toBe("Receive");
    expect(transferTypeLabel(TransferType.DEDUCT)).toBe("Deduct");
  });
  it("marks deduct/restore as auto", () => {
    expect(isAutoType(TransferType.DEDUCT)).toBe(true);
    expect(isAutoType(TransferType.RESTORE)).toBe(true);
    expect(isAutoType(TransferType.TRANSFER)).toBe(false);
  });
});

describe("resolveEndpoint", () => {
  it("names a warehouse and container from the map", () => {
    expect(resolveEndpoint(LocationType.WAREHOUSE, "w1", undefined, map)).toMatchObject({ kind: "warehouse", name: "Central Warehouse" });
    expect(resolveEndpoint(LocationType.CONTAINER, "c1", undefined, map)).toMatchObject({ kind: "container", name: "Riley Santos" });
  });
  it("labels a supplier", () => {
    expect(resolveEndpoint(LocationType.SUPPLIER, null, undefined, map)).toMatchObject({ kind: "supplier", name: "Supplier" });
  });
  it("resolves a null side to a deal from the notes", () => {
    const e = resolveEndpoint(null, null, "Deal: DEAL-1042", map);
    expect(e.kind).toBe("deal");
    expect(e.dealId).toBe("DEAL-1042");
  });
  it("falls back to a generic name when the id is unknown", () => {
    expect(resolveEndpoint(LocationType.WAREHOUSE, "w9", undefined, map).name).toBe("Warehouse");
  });
});

describe("filterByType", () => {
  const rows = [
    { type: TransferType.RECEIVE },
    { type: TransferType.TRANSFER },
    { type: TransferType.DEDUCT },
  ] as Transfer[];
  it("returns all for 'all'", () => {
    expect(filterByType(rows, "all")).toHaveLength(3);
  });
  it("filters by a single type", () => {
    expect(filterByType(rows, TransferType.TRANSFER)).toHaveLength(1);
  });
});
