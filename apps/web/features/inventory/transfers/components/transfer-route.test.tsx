import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationType, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { TransferRoute } from "./transfer-route";

const map = new Map<string, string>([
  ["w1", "Central Warehouse"],
  ["c1", "Riley Santos"],
]);

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

describe("TransferRoute", () => {
  it("resolves warehouse and container names from the map", () => {
    render(<TransferRoute transfer={transfer({})} locationMap={map} />);
    expect(screen.getByText("Central Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Riley Santos")).toBeInTheDocument();
  });

  it("shows the deal id for a deduct (null counterparty)", () => {
    render(
      <TransferRoute
        transfer={transfer({
          type: TransferType.DEDUCT,
          fromType: LocationType.CONTAINER,
          fromId: "c1",
          toType: null,
          toId: null,
          notes: "Deal: DEAL-1042",
        })}
        locationMap={map}
      />,
    );
    expect(screen.getByText("DEAL-1042")).toBeInTheDocument();
  });
});
