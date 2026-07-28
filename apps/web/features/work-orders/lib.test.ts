import { describe, it, expect } from "vitest";
import { WorkOrderStatus, type WorkOrder } from "@bitcrm/types";
import { workOrderStatusLabel, filterWorkOrders } from "./lib";

function wo(over: Partial<WorkOrder>): WorkOrder {
  return {
    id: "w1", woNumber: "WO-1", companyId: "c1", date: "2026-11-05",
    status: WorkOrderStatus.OPEN, createdBy: "u1", createdAt: "", updatedAt: "",
    ...over,
  };
}

describe("workOrderStatusLabel", () => {
  it("maps statuses to friendly labels", () => {
    expect(workOrderStatusLabel(WorkOrderStatus.OPEN)).toBe("Open");
    expect(workOrderStatusLabel(WorkOrderStatus.IN_PROGRESS)).toBe("In progress");
    expect(workOrderStatusLabel(WorkOrderStatus.CLOSED)).toBe("Closed");
    expect(workOrderStatusLabel(WorkOrderStatus.ARCHIVED)).toBe("Archived");
  });
});

describe("filterWorkOrders", () => {
  const list = [
    wo({ id: "a", companyId: "c1", status: WorkOrderStatus.OPEN, woNumber: "WO-100" }),
    wo({ id: "b", companyId: "c2", status: WorkOrderStatus.CLOSED, woNumber: "WO-200" }),
    wo({ id: "c", companyId: "c1", status: WorkOrderStatus.CLOSED, woNumber: "WO-300" }),
  ];

  it("returns all with no filters", () => {
    expect(filterWorkOrders(list, {})).toHaveLength(3);
  });
  it("filters by company", () => {
    expect(filterWorkOrders(list, { companyId: "c1" }).map((w) => w.id)).toEqual(["a", "c"]);
  });
  it("filters by status", () => {
    expect(filterWorkOrders(list, { status: WorkOrderStatus.CLOSED }).map((w) => w.id)).toEqual(["b", "c"]);
  });
  it("matches a WO-number query (case-insensitive)", () => {
    expect(filterWorkOrders(list, { query: "wo-100" }).map((w) => w.id)).toEqual(["a"]);
  });
  it("combines filters", () => {
    expect(filterWorkOrders(list, { companyId: "c1", status: WorkOrderStatus.CLOSED }).map((w) => w.id)).toEqual(["c"]);
  });
});
