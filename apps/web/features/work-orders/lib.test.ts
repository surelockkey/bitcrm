import { describe, it, expect } from "vitest";
import { WorkOrderStatus, type WorkOrder } from "@bitcrm/types";
import {
  WORK_ORDER_STATUSES,
  filterWorkOrders,
  workOrderCardText,
  workOrderFilterGroups,
  workOrderHref,
  workOrderPaperRows,
  workOrderStats,
  workOrderStatusLabel,
  workOrdersCsv,
} from "./lib";

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

  it("lists the statuses in their working order — the cards' order", () => {
    expect(WORK_ORDER_STATUSES).toEqual([
      WorkOrderStatus.OPEN,
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.CLOSED,
      WorkOrderStatus.ARCHIVED,
    ]);
  });
});

describe("filterWorkOrders — the Filter results picks", () => {
  const list = [
    wo({ id: "a", companyId: "c1", status: WorkOrderStatus.OPEN }),
    wo({ id: "b", companyId: "c2", status: WorkOrderStatus.CLOSED }),
    wo({ id: "c", companyId: "c1", status: WorkOrderStatus.CLOSED }),
    wo({ id: "d", companyId: "c3", status: WorkOrderStatus.IN_PROGRESS }),
  ];

  it("returns all with nothing picked", () => {
    expect(filterWorkOrders(list, {})).toHaveLength(4);
  });
  it("keeps any picked status (OR inside a group)", () => {
    expect(filterWorkOrders(list, { status: ["closed", "in_progress"] }).map((w) => w.id)).toEqual(["b", "c", "d"]);
  });
  it("keeps any picked company", () => {
    expect(filterWorkOrders(list, { company: ["c1", "c3"] }).map((w) => w.id)).toEqual(["a", "c", "d"]);
  });
  it("needs every group to match (AND between groups)", () => {
    expect(filterWorkOrders(list, { status: ["closed"], company: ["c1"] }).map((w) => w.id)).toEqual(["c"]);
  });
  it("an emptied group filters nothing", () => {
    expect(filterWorkOrders(list, { status: [] })).toHaveLength(4);
  });
});

describe("workOrderFilterGroups", () => {
  const companies = [
    { id: "c2", title: "Zeta Corp" },
    { id: "c1", title: "ABC Supply" },
    { id: "c9", title: "Never Used" },
  ];

  it("offers Status, then the companies that have work orders, by name", () => {
    const groups = workOrderFilterGroups(companies, [wo({ companyId: "c2" }), wo({ companyId: "c1" }), wo({ companyId: "c1" })]);
    expect(groups.map((g) => [g.key, g.label, g.chip])).toEqual([
      ["status", "Status", "status"],
      ["company", "Client", "client"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Open", "In progress", "Closed", "Archived"]);
    expect(groups[1].options).toEqual([
      { value: "c1", label: "ABC Supply" },
      { value: "c2", label: "Zeta Corp" },
    ]);
  });

  it("names a company it cannot find by its id rather than dropping it", () => {
    const groups = workOrderFilterGroups([], [wo({ companyId: "c7" })]);
    expect(groups[1].options).toEqual([{ value: "c7", label: "c7" }]);
  });
});

describe("workOrderStats + workOrderCardText — the status cards", () => {
  const list = [
    wo({ status: WorkOrderStatus.OPEN, amount: 1000 }),
    wo({ status: WorkOrderStatus.OPEN, amount: 250.5 }),
    wo({ status: WorkOrderStatus.OPEN }),
    wo({ status: WorkOrderStatus.CLOSED, amount: 99 }),
  ];

  it("counts and sums each status, a missing amount as nothing", () => {
    const stats = workOrderStats(list);
    expect(stats[WorkOrderStatus.OPEN]).toEqual({ count: 3, amount: 1250.5 });
    expect(stats[WorkOrderStatus.CLOSED]).toEqual({ count: 1, amount: 99 });
    expect(stats[WorkOrderStatus.IN_PROGRESS]).toEqual({ count: 0, amount: 0 });
    expect(stats[WorkOrderStatus.ARCHIVED]).toEqual({ count: 0, amount: 0 });
  });

  it("prints the status big over 'N Worth $X', as the Estimates cards do", () => {
    expect(workOrderCardText(WorkOrderStatus.OPEN, { count: 3, amount: 1250.5 })).toEqual({
      value: "Open",
      caption: "3 Worth $1,250.50",
      label: "3 Worth $1,250.50 Open",
    });
    expect(workOrderCardText(WorkOrderStatus.ARCHIVED, undefined).caption).toBe("0 Worth $0.00");
  });
});

describe("workOrdersCsv — Export", () => {
  it("writes the grid's columns, quoting what needs it", () => {
    const csv = workOrdersCsv(
      [
        wo({ woNumber: "WO-1", companyId: "c1", date: "2026-11-05", amount: 5000, status: WorkOrderStatus.OPEN, dealId: "d1", description: 'Rekey "all", front' }),
        wo({ woNumber: "WO-2", companyId: "c2", date: "2026-11-06", status: WorkOrderStatus.CLOSED }),
      ],
      { companyName: (id) => (id === "c1" ? "ABC Supply, Inc" : ""), jobNumber: (id) => (id === "d1" ? "PK4399" : "") },
    );
    expect(csv.split("\r\n")).toEqual([
      "WO NO.,Client,Date,Amount,Status,Job,Description",
      'WO-1,"ABC Supply, Inc",2026-11-05,5000.00,Open,PK4399,"Rekey ""all"", front"',
      "WO-2,,2026-11-06,,Closed,,",
    ]);
  });
});

describe("workOrderPaperRows — the paper's Order NO. table", () => {
  it("lists what the work order has, Workiz's Order NO. / Date first", () => {
    expect(
      workOrderPaperRows(wo({ woNumber: "WO-7", date: "2026-10-09", status: WorkOrderStatus.IN_PROGRESS }), { jobNumber: "PK4399" }),
    ).toEqual([
      ["Order NO.", "WO-7"],
      ["Date", "Fri Oct 09, 2026"],
      ["Status", "In progress"],
      ["Job", "PK4399"],
    ]);
  });

  it("leaves out the job when there is none to name", () => {
    expect(workOrderPaperRows(wo({ woNumber: "WO-7", date: "2026-10-09" }), {}).map((r) => r[0])).toEqual(["Order NO.", "Date", "Status"]);
  });
});

describe("workOrderHref", () => {
  it("links the work order's own view", () => {
    expect(workOrderHref("w 1")).toBe("/work-orders?id=w%201");
  });
});
