import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { TransferRecordDialog } from "./transfer-record-dialog";

const map = new Map<string, string>([["c1", "Taras's van"]]);

function transfer(over: Partial<Transfer>): Transfer {
  return {
    id: "t1234567890",
    type: TransferType.TRANSFER,
    fromType: LocationType.CONTAINER,
    fromId: "c1",
    toType: null,
    toId: null,
    items: [{ productId: "p1", productName: "Deadbolt", quantity: 2 }],
    performedBy: "u1",
    performedByName: "Jane Smith",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

function open(t: Transfer) {
  render(<TransferRecordDialog transfer={t} locationMap={map} open onOpenChange={() => {}} />);
}

describe("TransferRecordDialog", () => {
  it("says why a return took the stock out", () => {
    open(transfer({ type: TransferType.RETURN, reason: ReturnReason.DAMAGED, notes: "Cracked housing" }));
    expect(screen.getByText("Reason")).toBeInTheDocument();
    // The route names the reason too; the details row is the second mention.
    expect(screen.getAllByText("Damaged").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Cracked housing")).toBeInTheDocument();
  });

  it("links a job movement to its job", () => {
    open(transfer({ type: TransferType.DEDUCT, dealId: "deal-uuid-1" }));
    const links = screen.getAllByRole("link", { name: /job|deal-uuid-1/i });
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toHaveAttribute("href", "/deals/deal-uuid-1");
    expect(screen.getByText("Job")).toBeInTheDocument();
  });

  it("has no reason row for a plain move", () => {
    open(transfer({ toType: LocationType.WAREHOUSE, toId: "w1" }));
    expect(screen.queryByText("Reason")).toBeNull();
    expect(screen.queryByText("Job")).toBeNull();
  });
});
