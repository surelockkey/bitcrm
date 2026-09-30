import { describe, expect, it } from "vitest";
import {
  InventoryLogAction,
  LocationType,
  ReturnReason,
  UserContainerAccess,
} from "@bitcrm/types";
import { describeLogEntry, jobLabel } from "./describe";
import type { ReportLogEntry } from "./types";

const entry = (over: Partial<ReportLogEntry>): ReportLogEntry => ({
  id: "e1",
  action: InventoryLogAction.ITEM_CREATED,
  productId: "p1",
  productName: "Nest Thermostat",
  userId: "u1",
  userName: "Kristian Ibarra",
  createdAt: "2026-09-18T15:04:00.000Z",
  ...over,
});

describe("describeLogEntry — Workiz's wording", () => {
  it("item edits", () => {
    expect(describeLogEntry(entry({ action: InventoryLogAction.ITEM_CREATED }))).toBe("Created new item");
    expect(describeLogEntry(entry({ action: InventoryLogAction.ITEM_UPDATED }))).toBe("Updated item information");
    expect(describeLogEntry(entry({ action: InventoryLogAction.ITEM_ARCHIVED }))).toBe("Archived item");
    expect(describeLogEntry(entry({ action: InventoryLogAction.ITEM_RESTORED }))).toBe("Restored item");
  });

  it("an update names the fields it changed, in words", () => {
    expect(
      describeLogEntry(
        entry({ action: InventoryLogAction.ITEM_UPDATED, changedFields: ["priceClient", "costCompany", "sku", "weird"] }),
      ),
    ).toBe("Updated item information (price, cost, SKU, weird)");
  });

  it("stock received and moved", () => {
    expect(
      describeLogEntry(
        entry({ action: InventoryLogAction.STOCK_RECEIVED, quantity: 5, toType: LocationType.WAREHOUSE, toName: "(1) STORE" }),
      ),
    ).toBe("Added 5 to (1) STORE");
    expect(
      describeLogEntry(
        entry({ action: InventoryLogAction.STOCK_MOVED, quantity: 2, fromName: "Main", toName: "Van 7" }),
      ),
    ).toBe("Moved 2 from Main to Van 7");
  });

  it("used on a job, and returned from one — with the job's number when known", () => {
    const used = entry({ action: InventoryLogAction.STOCK_USED, quantity: 1, dealId: "d1", fromName: "Van 7" });
    expect(describeLogEntry(used, { jobNumber: 1749 })).toBe("Used 1 in job #1749");
    expect(describeLogEntry({ ...used, dealNumber: "1750" })).toBe("Used 1 in job #1750");
    // Unknown number: still the job, never an id.
    expect(describeLogEntry(used)).toBe("Used 1 in job");

    const back = entry({ action: InventoryLogAction.STOCK_RESTORED, quantity: 3, dealId: "d1", toName: "Van 7" });
    expect(describeLogEntry(back, { jobNumber: 1749 })).toBe("Returned 3 from job #1749 to Van 7");
  });

  it("removed from a location, with the reason when there is one", () => {
    const removed = entry({ action: InventoryLogAction.STOCK_RETURNED, quantity: 10, fromName: "Main" });
    expect(describeLogEntry({ ...removed, reason: ReturnReason.RECALL })).toBe("Removed 10 from Main (Recall)");
    expect(describeLogEntry(removed)).toBe("Removed 10 from Main");
  });

  it("a restore with nowhere to go", () => {
    expect(
      describeLogEntry(entry({ action: InventoryLogAction.STOCK_RESTORE_SKIPPED, quantity: 2, dealId: "d1" })),
    ).toBe("2 not returned to stock (no van)");
  });

  it("container assignments name the person, not an item", () => {
    const base = entry({
      action: InventoryLogAction.CONTAINER_ASSIGNED,
      productId: undefined,
      productName: undefined,
      subjectUserId: "u9",
      subjectUserName: "John Smith",
    });
    expect(describeLogEntry({ ...base, access: UserContainerAccess.CONTAINER, toName: "Van 7" })).toBe(
      "John Smith assigned to Van 7",
    );
    expect(describeLogEntry({ ...base, access: UserContainerAccess.ALL })).toBe("John Smith set to All locations");
    expect(describeLogEntry({ ...base, access: UserContainerAccess.NONE })).toBe("John Smith set to No access");
  });

  it("fractional quantities keep their decimals; names that are missing don't print 'undefined'", () => {
    expect(
      describeLogEntry(entry({ action: InventoryLogAction.STOCK_RECEIVED, quantity: 2.5 })),
    ).toBe("Added 2.5 to a location");
    expect(
      describeLogEntry(entry({ action: InventoryLogAction.STOCK_MOVED, quantity: 1 })),
    ).toBe("Moved 1 from a location to a location");
  });

  it("an action it doesn't know is shown as the server named it", () => {
    expect(describeLogEntry(entry({ action: "stock_teleported" as InventoryLogAction }))).toBe("stock_teleported");
  });
});

describe("jobLabel", () => {
  it("the number when known, as Workiz's Job column prints it, else just 'Job'", () => {
    expect(jobLabel(1749)).toBe("1749");
    expect(jobLabel("1750")).toBe("1750");
    expect(jobLabel(undefined)).toBe("Job");
  });
});
