import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/render-with-client";
import type { StockTarget } from "../lib";

// The dialogs have their own specs; here only which one opens, for what.
vi.mock("./stock-action-dialogs", () => {
  const stub = (kind: string) =>
    function Stub(props: { target: StockTarget; open: boolean; onOpenChange: (o: boolean) => void }) {
      return props.open ? (
        <div data-testid={`${kind}-dialog`}>
          {props.target.product.id}@{props.target.location.id}×{props.target.available}
          <button onClick={() => props.onOpenChange(false)}>close {kind}</button>
        </div>
      ) : null;
    };
  return {
    AddStockDialog: stub("add"),
    MoveStockDialog: stub("move"),
    ReturnStockDialog: stub("return"),
  };
});

import { StockRowActions } from "./stock-row-actions";

const target = (available: number): StockTarget => ({
  product: { id: "p1", name: "Deadbolt" },
  location: { type: "container", id: "c1", name: "Taras's van" },
  available,
});

describe("StockRowActions", () => {
  it("offers add, move and return, each named for its item and location", () => {
    renderWithClient(<StockRowActions target={target(4)} />);
    expect(screen.getByRole("button", { name: "Add Deadbolt to Taras's van" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Taras's van" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Taras's van" })).toBeEnabled();
  });

  it("has no add where stock only leaves (a location's own popup)", () => {
    renderWithClient(<StockRowActions target={target(4)} allowAdd={false} />);
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Move/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Return/ })).toBeInTheDocument();
  });

  it("can't move or return what isn't there, and can still add to it", () => {
    renderWithClient(<StockRowActions target={target(0)} />);
    expect(screen.getByRole("button", { name: /^Move/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Return/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Add/ })).toBeEnabled();
  });

  it("won't add to an archived location, but what's there can still leave", () => {
    renderWithClient(<StockRowActions target={target(4)} archived />);
    expect(screen.getByRole("button", { name: /^Add/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Move/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Return/ })).toBeEnabled();
  });

  it.each([
    ["Add", "add"],
    ["Move", "move"],
    ["Return", "return"],
  ])("%s opens its dialog for this item here, and closing it unmounts it", async (verb, kind) => {
    renderWithClient(<StockRowActions target={target(4)} />);
    expect(screen.queryByTestId(`${kind}-dialog`)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${verb}`) }));
    expect(screen.getByTestId(`${kind}-dialog`)).toHaveTextContent("p1@c1×4");

    await userEvent.click(screen.getByRole("button", { name: `close ${kind}` }));
    expect(screen.queryByTestId(`${kind}-dialog`)).toBeNull();
  });
});
