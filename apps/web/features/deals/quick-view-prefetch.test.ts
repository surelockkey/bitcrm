import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";

const api = vi.hoisted(() => ({ getContact: vi.fn(), getDealProducts: vi.fn() }));
vi.mock("@/features/clients/api", () => ({ getContact: api.getContact }));
vi.mock("./api", () => ({ getDealProducts: api.getDealProducts }));

import { prefetchQuickView } from "./quick-view-prefetch";

const deal: Deal = {
  id: "d1",
  dealNumber: "AB12CD",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "Phoenix",
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
  jobTypeId: "jt",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u1",
  priority: DealPriority.NORMAL,
  assignedTechIds: [],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

/**
 * The quick view must open whole, without a spinner and then a jump: the
 * list row already is the job, so it is seeded as the job's own cache entry,
 * and the client and the lines are asked for while the cursor is still on
 * the row.
 */
describe("prefetchQuickView", () => {
  beforeEach(() => {
    api.getContact.mockReset().mockResolvedValue({ id: "c1" });
    api.getDealProducts.mockReset().mockResolvedValue([]);
  });

  it("seeds the job from the row and warms the client and lines", async () => {
    const qc = new QueryClient();
    prefetchQuickView(qc, deal);
    expect(qc.getQueryData(queryKeys.deals.detail("d1"))).toEqual(deal);
    await vi.waitFor(() => {
      expect(api.getContact).toHaveBeenCalledWith("c1");
      expect(api.getDealProducts).toHaveBeenCalledWith("d1");
    });
  });

  it("never overwrites a job already in hand with the row's copy", () => {
    const qc = new QueryClient();
    const fresher = { ...deal, notes: "edited here" };
    qc.setQueryData(queryKeys.deals.detail("d1"), fresher);
    prefetchQuickView(qc, deal);
    expect(qc.getQueryData(queryKeys.deals.detail("d1"))).toEqual(fresher);
  });
});
