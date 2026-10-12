import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemGroup } from "@bitcrm/types";
import { ItemGroupChoices, ItemGroupConfirm } from "./item-group-picker";

const group = (id: string, name: string, over: Partial<ItemGroup> = {}): ItemGroup => ({
  id,
  name,
  description: "",
  groupType: "separate_items",
  active: true,
  total: 270,
  members: [
    { productId: "p1", name: "Service Trip Charge", quantity: 1, priceClient: 45, taxable: true, description: "", customAttributes: {} },
    { productId: "p2", name: "Labor for Spring Adjustment", quantity: 1, priceClient: 225, taxable: true, description: "", customAttributes: {} },
  ],
  ...over,
});

describe("ItemGroupChoices", () => {
  it("lists the groups with how many items and their total; a click picks one", async () => {
    const onPick = vi.fn();
    render(<ItemGroupChoices groups={[group("g1", "spring adjustment")]} onPick={onPick} />);

    const choice = screen.getByRole("button", { name: /spring adjustment/ });
    expect(within(choice).getByText("2 items · $270.00")).toBeInTheDocument();
    await userEvent.click(choice);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });

  it("shows a few while nothing is typed and says how to find the rest", () => {
    const many = Array.from({ length: 8 }, (_, i) => group(`g${i}`, `Group ${i}`));
    render(<ItemGroupChoices groups={many} limit={5} onPick={vi.fn()} />);

    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByText("Type to find the other 3 groups")).toBeInTheDocument();
  });

  it("draws nothing without groups", () => {
    const { container } = render(<ItemGroupChoices groups={[]} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ItemGroupConfirm", () => {
  it("shows what the group adds — each line, quantity × price — and the total, then adds it", async () => {
    const onSubmit = vi.fn();
    const onBack = vi.fn();
    render(
      <ItemGroupConfirm
        group={group("g1", "spring adjustment", { members: [{ ...group("x", "x").members[0], quantity: 2 }] , total: 90 })}
        submitLabel="Add group"
        note="Parts come out of Bob's van."
        onBack={onBack}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("spring adjustment")).toBeInTheDocument();
    expect(screen.getByText("Service Trip Charge")).toBeInTheDocument();
    expect(screen.getByText("2 × $45.00")).toBeInTheDocument();
    expect(screen.getByText("$90.00")).toBeInTheDocument();
    expect(screen.getByText("Parts come out of Bob's van.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(onSubmit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
