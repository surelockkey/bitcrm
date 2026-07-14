import { describe, it, expect } from "vitest";
import {
  DealStage,
  DealStageGroup,
  DealPriority,
  DealStatus,
  ClientType,
} from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";
import {
  stageLabel,
  stageGroup,
  groupLabel,
  STAGE_ORDER,
  jobTypeLabel,
  priorityLabel,
  isUrgent,
  formatMoney,
  dealTotal,
  priceRange,
  isPriceInBand,
  isTerminal,
  filterDeals,
} from "./lib";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: 1042,
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobType: "lockout",
    stage: DealStage.NEW_LEAD,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tags: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function product(over: Partial<DealProduct> = {}): DealProduct {
  return {
    productId: "p1",
    name: "Deadbolt",
    sku: "LOCK-1",
    quantity: 1,
    costCompany: 10,
    costForTech: 18,
    priceClient: 45,
    addedBy: "u1",
    addedAt: "",
    ...over,
  };
}

describe("stage helpers", () => {
  it("labels stages", () => {
    expect(stageLabel(DealStage.NEW_LEAD)).toBe("New Lead");
    expect(stageLabel(DealStage.WORK_IN_PROGRESS)).toBe("Work In Progress");
    expect(stageLabel(DealStage.PENDING_PAYMENT)).toBe("Pending Payment");
  });
  it("maps stages to groups", () => {
    expect(stageGroup(DealStage.NEW_LEAD)).toBe(DealStageGroup.SUBMITTED);
    expect(stageGroup(DealStage.EN_ROUTE)).toBe(DealStageGroup.IN_PROGRESS);
    expect(stageGroup(DealStage.ON_HOLD)).toBe(DealStageGroup.PENDING);
    expect(stageGroup(DealStage.COMPLETED)).toBe(DealStageGroup.CLOSED);
  });
  it("labels groups and orders all 13 stages", () => {
    expect(groupLabel(DealStageGroup.IN_PROGRESS)).toBe("In Progress");
    expect(STAGE_ORDER).toHaveLength(13);
    expect(STAGE_ORDER[0]).toBe(DealStage.NEW_LEAD);
  });
  it("knows terminal stages", () => {
    expect(isTerminal(DealStage.COMPLETED)).toBe(true);
    expect(isTerminal(DealStage.CANCELED)).toBe(true);
    expect(isTerminal(DealStage.ASSIGNED)).toBe(false);
  });
});

describe("labels", () => {
  it("labels known job types and titlecases unknown", () => {
    expect(jobTypeLabel("lock_change")).toBe("Lock Change");
    expect(jobTypeLabel("automotive")).toBe("Automotive");
    expect(jobTypeLabel("gate_repair")).toBe("Gate Repair");
  });
  it("labels priority + urgency", () => {
    expect(priorityLabel(DealPriority.URGENT)).toBe("Urgent");
    expect(isUrgent(deal({ priority: DealPriority.URGENT }))).toBe(true);
    expect(isUrgent(deal())).toBe(false);
  });
});

describe("money", () => {
  it("formats dollars", () => {
    expect(formatMoney(140)).toBe("$140.00");
    expect(formatMoney(45.5)).toBe("$45.50");
  });
  it("sums line items", () => {
    expect(dealTotal([product({ quantity: 2, priceClient: 45 }), product({ priceClient: 95 })])).toBe(185);
    expect(dealTotal([])).toBe(0);
  });
});

describe("price band (±15%)", () => {
  it("computes the allowed range off catalog price", () => {
    const r = priceRange(45);
    expect(r.min).toBeCloseTo(38.25, 2);
    expect(r.max).toBeCloseTo(51.75, 2);
  });
  it("validates a price against the band", () => {
    expect(isPriceInBand(45, 45)).toBe(true);
    expect(isPriceInBand(50, 45)).toBe(true);
    expect(isPriceInBand(52, 45)).toBe(false);
    expect(isPriceInBand(38, 45)).toBe(false);
  });
});

describe("filterDeals", () => {
  const names = new Map<string, string>([["c1", "Jane Smith"], ["c2", "Marcus Reyes"]]);
  const list = [
    deal({ id: "a", dealNumber: 1042, contactId: "c1", stage: DealStage.NEW_LEAD, priority: DealPriority.URGENT, jobType: "lockout" }),
    deal({ id: "b", dealNumber: 1040, contactId: "c2", stage: DealStage.ASSIGNED, jobType: "rekey", assignedTechId: "t9" }),
  ];
  it("returns all with no filters", () => {
    expect(filterDeals(list, {}, names)).toHaveLength(2);
  });
  it("filters by stage and priority", () => {
    expect(filterDeals(list, { stage: DealStage.NEW_LEAD }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { priority: DealPriority.URGENT }, names).map((d) => d.id)).toEqual(["a"]);
  });
  it("searches by deal number and client name", () => {
    expect(filterDeals(list, { search: "1040" }, names).map((d) => d.id)).toEqual(["b"]);
    expect(filterDeals(list, { search: "jane" }, names).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { search: "#1042" }, names).map((d) => d.id)).toEqual(["a"]);
  });
});
