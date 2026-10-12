import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemGroup, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  groups: [] as ItemGroup[] | undefined,
  categories: [] as ProductCategory[],
  enabled: [] as boolean[],
  updates: [] as { id: string; body: unknown }[],
  denied: new Set<string>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/price-book/groups",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    isLoading: false,
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useItemCategories: () => ({ data: mocks.categories, isLoading: false, isError: false }),
}));
vi.mock("./hooks", () => ({
  useItemGroups: (enabled: boolean) => {
    mocks.enabled.push(enabled);
    return { data: mocks.groups, isLoading: mocks.groups === undefined, isError: false };
  },
  useCreateItemGroup: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateItemGroup: () => ({
    isPending: false,
    mutate: ({ id, body }: { id: string; body: unknown }, opts?: { onSuccess?: () => void }) => {
      mocks.updates.push({ id, body });
      opts?.onSuccess?.();
    },
  }),
}));

import { ItemGroupsTab } from "./item-groups-tab";

const member = (name: string, priceClient: number, quantity = 1) => ({
  productId: `p-${name}`,
  name,
  quantity,
  priceClient,
  taxable: true,
  description: "",
  customAttributes: {},
});

const group = (id: string, name: string, over: Partial<ItemGroup> = {}): ItemGroup => ({
  id,
  name,
  description: "",
  groupType: "separate_items",
  active: true,
  members: [member("Service Trip Charge", 45), member("Labor for Spring Adjustment", 225)],
  total: 270,
  ...over,
});

const grid = () => document.querySelector("[data-slot=wz-report-grid]") as HTMLElement;
const heads = () =>
  [...grid().querySelectorAll("thead th")]
    .filter((th) => !th.closest(".sr-only"))
    .map((th) => th.textContent?.trim());
const records = () => [...grid().querySelectorAll("tbody tr:not([aria-hidden])")].filter((tr) => tr.querySelectorAll("td").length > 1);
const rowNames = () => records().map((tr) => tr.querySelector("td")?.textContent);
const rowOf = (name: string) => records().find((tr) => tr.querySelector("td")?.textContent === name) as HTMLElement;

beforeEach(() => {
  mocks.groups = [
    group("g1", "spring adjustment"),
    group("g2", "Commercial door", { description: "Steel, 3070", categoryId: "c2", total: 3657.6 }),
    group("g3", "DAVID\"S JOB", { active: false }),
  ];
  mocks.categories = [
    { id: "c1", name: "Doors", active: true } as ProductCategory,
    { id: "c2", name: "Doors > Commercial", active: true } as ProductCategory,
  ];
  mocks.enabled = [];
  mocks.updates = [];
  mocks.denied = new Set();
});

describe("Price book → Item groups (Workiz /root/service_and_products/2)", () => {
  it("says what groups are for, and offers Add New to whoever may create items", () => {
    renderWithClient(<ItemGroupsTab />);

    expect(screen.getByText("Item groups help you add multiple items to invoices and estimates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New" })).toBeInTheDocument();
  });

  it("reads the groups with products.view and lists the active ones by name in Workiz's columns", () => {
    renderWithClient(<ItemGroupsTab />);

    expect(mocks.enabled.every(Boolean)).toBe(true);
    expect(heads()).toEqual(["Name", "Description", "Items", "Group type", "Total", "Category", "Actions"]);
    expect(rowNames()).toEqual(["Commercial door", "spring adjustment"]);
    const door = within(rowOf("Commercial door"));
    expect(door.getByText("Steel, 3070")).toBeInTheDocument();
    expect(door.getByText("Service Trip Charge, Labor for Spring Adjustment")).toBeInTheDocument();
    expect(door.getByText("Individual items")).toBeInTheDocument();
    expect(door.getByText("$3,657.60")).toBeInTheDocument();
    expect(door.getByText("Commercial")).toBeInTheDocument();
  });

  it("switches between Active, All and Disabled in Workiz's status box", async () => {
    renderWithClient(<ItemGroupsTab />);
    const box = screen.getByRole("combobox", { name: "Status" });

    await userEvent.click(box);
    await userEvent.click(await screen.findByRole("option", { name: "Disabled" }));
    expect(rowNames()).toEqual(['DAVID"S JOB']);
    await userEvent.click(box);
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    expect(rowNames()).toHaveLength(3);
  });

  it("searches names, descriptions and items in place", async () => {
    renderWithClient(<ItemGroupsTab />);

    await userEvent.type(screen.getByPlaceholderText("Search"), "steel");
    expect(rowNames()).toEqual(["Commercial door"]);
  });

  it("pages fifty at a time by default, as Workiz's groups tab does", () => {
    mocks.groups = Array.from({ length: 52 }, (_, i) => group(`x${i}`, `Group ${String(i).padStart(2, "0")}`));
    renderWithClient(<ItemGroupsTab />);

    expect(records()).toHaveLength(50);
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Showing 1 to 50 of 52 results");
  });

  it("opens Create item group from Add New, and Edit item group from the pencil, filled in", async () => {
    renderWithClient(<ItemGroupsTab />);

    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByRole("dialog", { name: "Create item group" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await userEvent.click(within(rowOf("Commercial door")).getByRole("button", { name: "Edit item group Commercial door" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item group" });
    expect(within(dialog).getByLabelText("Item group name")).toHaveValue("Commercial door");
  });

  it("disables a group from the trash after Workiz's confirm — it is kept, not erased", async () => {
    renderWithClient(<ItemGroupsTab />);

    await userEvent.click(within(rowOf("spring adjustment")).getByRole("button", { name: "Delete item group spring adjustment" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("disabled, not erased");
    await userEvent.click(within(confirm).getByRole("button", { name: /yes|delete|confirm/i }));

    expect(mocks.updates).toEqual([{ id: "g1", body: { active: false } }]);
  });

  it("offers no Add New without products.create and no pencil or trash without products.edit", () => {
    mocks.denied = new Set(["products.create", "products.edit"]);
    renderWithClient(<ItemGroupsTab />);

    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    expect(within(rowOf("Commercial door")).queryAllByRole("button")).toEqual([]);
  });

  it("says No access without products.view", () => {
    mocks.denied = new Set(["products.view"]);
    renderWithClient(<ItemGroupsTab />);

    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("draws Workiz's grid under its loader while the groups load", () => {
    mocks.groups = undefined;
    renderWithClient(<ItemGroupsTab />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
