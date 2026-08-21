import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, type ProductCategoryWithCounts } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  perms: { view: true, create: true, edit: true, delete: true },
  toggle: vi.fn(),
  categories: [] as ProductCategoryWithCounts[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (_r: string, action?: string) =>
      action ? mocks.perms[action as keyof typeof mocks.perms] : mocks.perms.view,
  }),
}));

vi.mock("../hooks", () => ({
  useProductCategories: () => ({ data: mocks.categories, isLoading: false }),
  useToggleProductCategory: () => ({ mutate: mocks.toggle, isPending: false }),
  useCreateProductCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProductCategory: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProductCategoriesPage } from "./product-categories-page";

const cat = (over: Partial<ProductCategoryWithCounts>): ProductCategoryWithCounts => ({
  id: "c-1",
  name: "Locks",
  status: InventoryStatus.ACTIVE,
  activeItemCount: 0,
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => {
  mocks.perms = { view: true, create: true, edit: true, delete: true };
  mocks.toggle.mockClear();
  mocks.categories = [
    cat({ id: "c-1", name: "Locks", activeItemCount: 347 }),
    cat({ id: "c-2", name: "Deadbolts", parentId: "c-1", parentName: "Locks", activeItemCount: 161 }),
    cat({ id: "c-3", name: "Key blanks", status: InventoryStatus.ARCHIVED }),
  ];
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("ProductCategoriesPage", () => {
  it("lists categories with their parent, item count and status", () => {
    render(<ProductCategoriesPage />);

    // "Locks" shows twice — as its own row, and as Deadbolts' parent.
    expect(screen.getAllByText("Locks")).toHaveLength(2);
    expect(screen.getByText("Deadbolts")).toBeInTheDocument();
    expect(screen.getByText("347")).toBeInTheDocument();
    expect(screen.getByText("161")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("reads a child under its parent, indented", () => {
    render(<ProductCategoriesPage />);

    const names = screen
      .getAllByTestId("category-name")
      .map((el) => el.textContent);
    expect(names).toEqual(["Key blanks", "Locks", "Deadbolts"]);
  });

  it("filters by name and keeps a matching child visible", async () => {
    render(<ProductCategoriesPage />);

    await user().type(screen.getByLabelText("Search categories"), "deadbolt");

    expect(screen.getByText("Deadbolts")).toBeInTheDocument();
    expect(screen.queryByText("Key blanks")).not.toBeInTheDocument();
  });

  it("warns that disabling a category takes everything nested with it", async () => {
    render(<ProductCategoriesPage />);

    await user().click(screen.getByRole("button", { name: "Disable Locks" }));

    expect(
      screen.getByText(/disable all subcategories and the items filed under them/i),
    ).toBeInTheDocument();
    expect(mocks.toggle).not.toHaveBeenCalled();

    await user().click(screen.getByRole("button", { name: "Disable category" }));
    expect(mocks.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-1", active: false }),
      expect.anything(),
    );
  });

  it("enables without a confirmation — nothing is lost by turning one back on", async () => {
    render(<ProductCategoriesPage />);

    await user().click(screen.getByRole("button", { name: "Enable Key blanks" }));

    expect(mocks.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-3", active: true }),
    );
  });

  it("hides every write control from a read-only user", () => {
    mocks.perms = { view: true, create: false, edit: false, delete: false };
    render(<ProductCategoriesPage />);

    expect(screen.queryByRole("button", { name: /new category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable Locks" })).not.toBeInTheDocument();
  });
});
