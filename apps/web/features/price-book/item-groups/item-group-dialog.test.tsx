import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType, type ItemGroup, type Product, type ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  creates: [] as unknown[],
  updates: [] as { id: string; body: unknown }[],
  searches: [] as unknown[],
  results: [] as Product[],
  categories: [] as ProductCategory[],
  denied: new Set<string>(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    isLoading: false,
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useItemCategories: () => ({ data: mocks.categories, isLoading: false, isError: false }),
}));
vi.mock("@/features/inventory/products/api", () => ({
  listProducts: async (filter: unknown) => {
    mocks.searches.push(filter);
    return { data: mocks.results, pagination: {} };
  },
}));
vi.mock("./hooks", () => ({
  useCreateItemGroup: () => ({
    isPending: false,
    mutate: (body: unknown, opts?: { onSuccess?: () => void }) => {
      mocks.creates.push(body);
      opts?.onSuccess?.();
    },
  }),
  useUpdateItemGroup: () => ({
    isPending: false,
    mutate: ({ id, body }: { id: string; body: unknown }, opts?: { onSuccess?: () => void }) => {
      mocks.updates.push({ id, body });
      opts?.onSuccess?.();
    },
  }),
}));

import { ItemGroupDialog } from "./item-group-dialog";

const product = (over: Partial<Product>): Product =>
  ({
    id: "p",
    sku: "WZ-1",
    name: "Item",
    category: "Doors",
    type: ProductType.PRODUCT,
    costCompany: 0,
    costTech: 0,
    priceClient: 0,
    serialTracking: false,
    minimumStockLevel: 0,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Product;

const ecobee = product({ id: "p-ecobee", name: "Ecobee3 Lite Thermostat Wifi", priceClient: 379.95, costCompany: 227.4 });
const labor = product({ id: "p-labor", name: "Residential labor", type: ProductType.SERVICE, priceClient: 250, costCompany: 0 });

const group: ItemGroup = {
  id: "g1",
  name: "Ecobee3 Lite Thermostat Wifi",
  description: "",
  groupType: "separate_items",
  categoryId: "c1",
  active: true,
  total: 754.95,
  members: [
    { productId: "p-ecobee", name: "Ecobee3 Lite Thermostat Wifi", quantity: 1, priceClient: 379.95, cost: 227.4, taxable: true, description: "", customAttributes: {} },
    { productId: "p-labor", name: "Residential labor", quantity: 1.5, priceClient: 250, cost: 0, taxable: true, description: "", customAttributes: {} },
  ],
};

const dialog = () => screen.getByRole("dialog");
const lineRows = () => within(dialog()).queryAllByTestId("item-group-line");
const box = (row: HTMLElement, label: string) => within(row).getByRole("textbox", { name: label }) as HTMLInputElement;

beforeEach(() => {
  mocks.creates = [];
  mocks.updates = [];
  mocks.searches = [];
  mocks.results = [ecobee, labor];
  mocks.categories = [{ id: "c1", name: "HVAC services", active: true } as ProductCategory];
  mocks.denied = new Set();
});

describe("Create item group (Workiz's popup)", () => {
  it("draws Workiz's fields: name, a fixed Individual items type, description, Add items, category, the grid and Total: $0", () => {
    renderWithClient(<ItemGroupDialog mode="new" onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Create item group" })).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Item group name")).toHaveValue("");
    expect(within(dialog()).getByText("Group type")).toBeInTheDocument();
    expect(within(dialog()).getByRole("combobox", { name: "Group type" })).toHaveTextContent("Individual items");
    expect(within(dialog()).getByRole("combobox", { name: "Group type" })).toBeDisabled();
    expect(within(dialog()).getByPlaceholderText("Item group description")).toBeInTheDocument();
    expect(within(dialog()).getByRole("combobox", { name: "Add items" })).toBeInTheDocument();
    expect(within(dialog()).getByText("Choose category (optional)")).toBeInTheDocument();
    const heads = within(dialog()).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(heads).toEqual(["Item name", "Price", "Cost", "Quantity", "Margin", "Amount", ""]);
    expect(within(dialog()).getByTestId("item-group-total")).toHaveTextContent("Total: $0.00");
  });

  it("adds items from the price book search at their price and cost, works out margin, amount and total", async () => {
    renderWithClient(<ItemGroupDialog mode="new" onClose={() => {}} />);

    await userEvent.type(within(dialog()).getByRole("combobox", { name: "Add items" }), "eco");
    await waitFor(() => expect(mocks.searches.at(-1)).toMatchObject({ search: "eco", status: InventoryStatus.ACTIVE }));
    await userEvent.click(await screen.findByRole("option", { name: /Ecobee3 Lite Thermostat Wifi/ }));
    await userEvent.type(within(dialog()).getByRole("combobox", { name: "Add items" }), "lab");
    await userEvent.click(await screen.findByRole("option", { name: /Residential labor/ }));

    const [first, second] = lineRows();
    expect(within(first).getByText("Ecobee3 Lite Thermostat Wifi")).toBeInTheDocument();
    expect(within(first).getByText("Product")).toBeInTheDocument();
    expect(box(first, "Price")).toHaveValue("379.95");
    expect(box(first, "Cost")).toHaveValue("227.4");
    expect(box(first, "Quantity")).toHaveValue("1");
    expect(within(first).getByText("40.15%")).toBeInTheDocument();
    expect(within(first).getByText("379.95")).toBeInTheDocument();

    await userEvent.clear(box(second, "Quantity"));
    await userEvent.type(box(second, "Quantity"), "1.5");
    expect(within(second).getByText("375.00")).toBeInTheDocument();
    expect(within(second).getByText("100.00%")).toBeInTheDocument();
    expect(within(dialog()).getByTestId("item-group-total")).toHaveTextContent("Total: $754.95");
  });

  it("saves the group with its lines", async () => {
    const onClose = vi.fn();
    renderWithClient(<ItemGroupDialog mode="new" onClose={onClose} />);

    await userEvent.type(within(dialog()).getByLabelText("Item group name"), "Thermostat install");
    await userEvent.type(within(dialog()).getByPlaceholderText("Item group description"), "Ecobee + labor");
    await userEvent.type(within(dialog()).getByRole("combobox", { name: "Add items" }), "eco");
    await userEvent.click(await screen.findByRole("option", { name: /Ecobee3/ }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(mocks.creates).toEqual([
      {
        name: "Thermostat install",
        description: "Ecobee + labor",
        categoryId: "",
        members: [
          { productId: "p-ecobee", name: "Ecobee3 Lite Thermostat Wifi", quantity: 1, priceClient: 379.95, cost: 227.4, taxable: true, description: "", customAttributes: {} },
        ],
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("asks for a name and an item before going to the server", async () => {
    renderWithClient(<ItemGroupDialog mode="new" onClose={() => {}} />);

    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(mocks.creates).toEqual([]);
    expect(within(dialog()).getByText("Name is required")).toBeInTheDocument();
    expect(within(dialog()).getByText("Add at least one item")).toBeInTheDocument();
  });

  it("hides Cost and Margin from someone who may not see money, and sends no cost", async () => {
    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ItemGroupDialog mode="new" onClose={() => {}} />);

    const heads = within(dialog()).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(heads).toEqual(["Item name", "Price", "Quantity", "Amount", ""]);
    await userEvent.type(within(dialog()).getByLabelText("Item group name"), "x");
    await userEvent.type(within(dialog()).getByRole("combobox", { name: "Add items" }), "eco");
    await userEvent.click(await screen.findByRole("option", { name: /Ecobee3/ }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect((mocks.creates[0] as { members: object[] }).members[0]).not.toHaveProperty("cost");
  });
});

describe("Edit item group", () => {
  it("opens on the group: its name, category and lines", () => {
    renderWithClient(<ItemGroupDialog mode="edit" group={group} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Edit item group" })).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Item group name")).toHaveValue("Ecobee3 Lite Thermostat Wifi");
    expect(within(dialog()).getByText("HVAC services")).toBeInTheDocument();
    expect(lineRows()).toHaveLength(2);
    expect(box(lineRows()[1], "Quantity")).toHaveValue("1.5");
    expect(within(dialog()).getByTestId("item-group-total")).toHaveTextContent("Total: $754.95");
  });

  it("sends only the members when a line changed, and closes without a request when nothing did", async () => {
    const onClose = vi.fn();
    const { unmount } = renderWithClient(<ItemGroupDialog mode="edit" group={group} onClose={onClose} />);

    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    renderWithClient(<ItemGroupDialog mode="edit" group={group} onClose={onClose} />);
    await userEvent.click(within(lineRows()[0]).getByRole("button", { name: "Remove Ecobee3 Lite Thermostat Wifi" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(mocks.updates).toEqual([
      {
        id: "g1",
        body: {
          members: [
            { productId: "p-labor", name: "Residential labor", quantity: 1.5, priceClient: 250, cost: 0, taxable: true, description: "", customAttributes: {} },
          ],
        },
      },
    ]);
  });

  it("switches a disabled group back on with Enable item group", async () => {
    renderWithClient(<ItemGroupDialog mode="edit" group={{ ...group, active: false }} onClose={() => {}} />);

    const toggle = within(dialog()).getByRole("switch", { name: "Enable item group" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(mocks.updates).toEqual([{ id: "g1", body: { active: true } }]);
  });

  it("shows a group to someone who may not edit, without Save", () => {
    mocks.denied = new Set(["products.edit"]);
    renderWithClient(<ItemGroupDialog mode="edit" group={group} onClose={() => {}} />);

    expect(within(dialog()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog()).getByLabelText("Item group name")).toBeDisabled();
  });
});
