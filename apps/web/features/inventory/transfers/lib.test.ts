import { describe, it, expect } from "vitest";
import { LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import {
  transferTypeLabel,
  isAutoType,
  resolveEndpoint,
  transferEndpoints,
  returnReasonLabel,
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
  it("labels a return", () => {
    expect(transferTypeLabel(TransferType.RETURN)).toBe("Return");
  });
  it("labels every return reason", () => {
    expect(returnReasonLabel(ReturnReason.RECALL)).toBe("Recall");
    expect(returnReasonLabel(ReturnReason.DAMAGED)).toBe("Damaged");
    expect(returnReasonLabel(ReturnReason.LOST)).toBe("Lost");
    expect(returnReasonLabel(ReturnReason.OTHER)).toBe("Other");
  });
  it("marks deduct/restore as auto", () => {
    expect(isAutoType(TransferType.DEDUCT)).toBe(true);
    expect(isAutoType(TransferType.RESTORE)).toBe(true);
    expect(isAutoType(TransferType.TRANSFER)).toBe(false);
    // A return is someone pressing "Return" in the stock popup.
    expect(isAutoType(TransferType.RETURN)).toBe(false);
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

function transfer(over: Partial<Transfer>): Transfer {
  return {
    id: "t1",
    type: TransferType.TRANSFER,
    fromType: LocationType.WAREHOUSE,
    fromId: "w1",
    toType: LocationType.CONTAINER,
    toId: "c1",
    items: [{ productId: "p1", productName: "Deadbolt", quantity: 1 }],
    performedBy: "u1",
    performedByName: "a@b.com",
    createdAt: "",
    ...over,
  };
}

describe("transferEndpoints", () => {
  it("resolves both location sides of a move", () => {
    const { from, to } = transferEndpoints(transfer({}), map);
    expect(from).toMatchObject({ kind: "warehouse", name: "Central Warehouse" });
    expect(to).toMatchObject({ kind: "container", name: "Riley Santos" });
  });

  it("takes the job from the transfer's own dealId", () => {
    const { to } = transferEndpoints(
      transfer({ type: TransferType.DEDUCT, fromType: LocationType.CONTAINER, fromId: "c1", toType: null, toId: null, dealId: "d-42" }),
      map,
    );
    expect(to).toMatchObject({ kind: "deal", dealId: "d-42" });
  });

  it("still reads the job out of the notes on records written before dealId", () => {
    const { to } = transferEndpoints(
      transfer({ type: TransferType.DEDUCT, toType: null, toId: null, notes: "Deal: DEAL-1042" }),
      map,
    );
    expect(to).toMatchObject({ kind: "deal", dealId: "DEAL-1042" });
  });

  it("names a return's empty side by its reason, never as a job", () => {
    const { from, to } = transferEndpoints(
      transfer({
        type: TransferType.RETURN,
        fromType: LocationType.CONTAINER,
        fromId: "c1",
        toType: null,
        toId: null,
        reason: ReturnReason.DAMAGED,
        // A free-text note that happens to look like the legacy deal marker.
        notes: "Deal: nope",
      }),
      map,
    );
    expect(from).toMatchObject({ kind: "container", name: "Riley Santos" });
    expect(to).toMatchObject({ kind: "return", name: "Damaged" });
  });
});
