import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryPicker, buildCategoryTree } from "./category-picker";

const names = ["Door Hardware", "Locks", "Locks > Residential", "Locks > Commercial", "Safes > Gun", "Uncategorized"];

describe("buildCategoryTree", () => {
  it("nests paths; a parent only implied by a longer name can be opened, not chosen", () => {
    const tree = buildCategoryTree(names);
    expect(tree.map((n) => n.name)).toEqual(["Door Hardware", "Locks", "Safes", "Uncategorized"]);
    const locks = tree.find((n) => n.name === "Locks")!;
    expect(locks.selectable).toBe(true);
    expect(locks.children.map((n) => n.path)).toEqual(["Locks > Commercial", "Locks > Residential"]);
    expect(tree.find((n) => n.name === "Safes")!.selectable).toBe(false);
  });
});

describe("CategoryPicker", () => {
  function open(value = "", onApply = vi.fn()) {
    const onOpenChange = vi.fn();
    render(<CategoryPicker categories={names} value={value} onOpenChange={onOpenChange} onApply={onApply} />);
    return { onApply, onOpenChange, picker: screen.getByTestId("category-picker") };
  }

  it("opening a category picks it; a subcategory tile picks that one; Apply hands it back", async () => {
    const user = userEvent.setup();
    const { onApply, picker } = open();

    expect(within(picker).getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "Locks" }));
    expect(within(picker).getByRole("heading", { name: "Locks" })).toBeInTheDocument();
    expect(within(picker).getByText("Categories›Locks")).toBeInTheDocument();

    await user.click(within(picker).getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith("Locks");

    await user.click(within(picker).getByRole("button", { name: "Locks > Residential" }));
    expect(within(picker).getByRole("button", { name: "Locks > Residential" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(picker).getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith("Locks > Residential");
  });

  it("opens where the current category lives and goes back up", async () => {
    const user = userEvent.setup();
    const { picker } = open("Locks > Commercial");
    expect(within(picker).getByRole("heading", { name: "Locks" })).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "Locks > Commercial" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(picker).getByRole("button", { name: "Back" }));
    expect(within(picker).getByRole("heading", { name: "Categories" })).toBeInTheDocument();
  });

  it("searches every level by name", async () => {
    const user = userEvent.setup();
    const { picker } = open();
    await user.type(within(picker).getByPlaceholderText("Search categories"), "resid");
    expect(within(picker).getAllByRole("listitem")).toHaveLength(1);
    expect(within(picker).getByText("Locks > Residential")).toBeInTheDocument();
  });

  it("Cancel closes without applying", async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange, picker } = open("Locks");
    await user.click(within(picker).getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
  });
});
