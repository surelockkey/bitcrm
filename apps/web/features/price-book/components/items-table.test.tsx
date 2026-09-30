import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { ItemsTable } from "./items-table";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 1042,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    brandId: "b1",
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const brandNames = new Map([["b1", "Schlage"]]);

function table(
  items: Product[] = [product()],
  over: Partial<Parameters<typeof ItemsTable>[0]> = {},
) {
  const onEdit = vi.fn();
  const utils = renderWithClient(
    <ItemsTable items={items} showCost brandNames={brandNames} onEdit={onEdit} {...over} />,
  );
  const headers = () =>
    [...utils.container.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
  const cell = (column: string, row = 1) => {
    const index = headers().indexOf(column);
    return utils.container.querySelectorAll(`tbody tr:nth-child(${row}) td`)[index] as HTMLElement;
  };
  return { ...utils, onEdit, headers, cell };
}

const ALL_COLUMNS = [
  "Product ID",
  "Name",
  "Type",
  "Category",
  "Brand",
  "Price",
  "Cost",
  "SKU",
  "Taxable",
  "Manage stock",
  "Status",
  "Actions",
];

describe("ItemsTable — columns", () => {
  it("lists the Price Book columns in order", () => {
    expect(table().headers()).toEqual(ALL_COLUMNS);
  });

  it("leaves Cost out for someone without financials.view", () => {
    const { headers } = table([product()], { showCost: false });
    expect(headers()).toEqual(ALL_COLUMNS.filter((c) => c !== "Cost"));
    expect(screen.queryByText("$10.00")).toBeNull();
  });

  it("left-aligns every header and cell — money included", () => {
    const { container } = table();
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/text-right|justify-end|text-center/);
    }
  });

  it("fills each cell from the item", () => {
    const { cell } = table([product({ taxable: false })]);
    expect(cell("Product ID")).toHaveTextContent("1042");
    expect(cell("Name")).toHaveTextContent("Deadbolt");
    expect(cell("Type")).toHaveTextContent("Product");
    expect(cell("Category")).toHaveTextContent("Locks");
    expect(cell("Brand")).toHaveTextContent("Schlage");
    expect(cell("Price")).toHaveTextContent("$45.00");
    expect(cell("Cost")).toHaveTextContent("$10.00");
    expect(cell("SKU")).toHaveTextContent("LOCK-001");
    expect(cell("Taxable")).toHaveTextContent("No");
    expect(cell("Manage stock")).toHaveTextContent("Yes");
    expect(cell("Status")).toHaveTextContent("Active");
  });

  it("puts a dash where the item has no number or brand", () => {
    const { cell } = table([product({ number: undefined, brandId: undefined })]);
    expect(cell("Product ID")).toHaveTextContent("—");
    expect(cell("Brand")).toHaveTextContent("—");
  });

  it("shows a dash for a service's Manage stock, whatever its flag", () => {
    const { cell } = table([
      product({ id: "s1", name: "Rekey", type: ProductType.SERVICE, manageStock: true }),
      product({ id: "p2", name: "Knob", manageStock: false }),
    ]);
    expect(cell("Type", 1)).toHaveTextContent("Service");
    expect(cell("Manage stock", 1)).toHaveTextContent(/^—$/);
    expect(cell("Manage stock", 2)).toHaveTextContent("No");
  });

  it("names the Workiz type of an imported service", () => {
    const { cell } = table([product({ type: ProductType.SERVICE, workizType: "hours" })]);
    expect(cell("Type")).toHaveTextContent("Service");
    expect(cell("Type")).toHaveTextContent("hours");
  });

  it("says Archived in the Status column", () => {
    expect(table([product({ status: InventoryStatus.ARCHIVED })]).cell("Status")).toHaveTextContent(
      "Archived",
    );
  });
});

describe("ItemsTable — actions", () => {
  it("opens the Edit popup on a row click", async () => {
    const { onEdit } = table();
    await userEvent.click(screen.getByText("LOCK-001"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("opens the Edit popup from the pencil", async () => {
    const { onEdit } = table();
    await userEvent.click(screen.getByRole("button", { name: "Edit Deadbolt" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps Archive in the kebab without opening the row", async () => {
    const { onEdit } = table();
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("offers Restore for an archived item", async () => {
    table([product({ status: InventoryStatus.ARCHIVED })]);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    expect(await screen.findByRole("menuitem", { name: "Restore" })).toBeInTheDocument();
  });
});

describe("ItemsTable — a stable frame", () => {
  it("draws the skeleton as this table: the same headers and one cell per column", () => {
    const loaded = table().headers();
    const { container, headers, unmount } = table([], { loading: true, skeletonRows: 4 });
    expect(headers()).toEqual(loaded);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.querySelectorAll("td")).toHaveLength(loaded.length);
    unmount();

    const noCost = table([], { loading: true, skeletonRows: 1, showCost: false });
    expect(noCost.container.querySelectorAll("tbody tr td")).toHaveLength(loaded.length - 1);
  });

  it("gives skeleton rows the real rows' height", () => {
    const real = table().container.querySelector("tbody tr")!.className;
    const height = real.match(/(^|\s)(h-\d+)/)?.[2];
    expect(height).toBeDefined();
    const { container } = table([], { loading: true, skeletonRows: 1 });
    expect(container.querySelector("tbody tr")!.className).toContain(height!);
  });

  it("lays the columns out at declared widths that fit a ~1250px content area", () => {
    const { container } = table();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
    const widths = [...container.querySelectorAll("colgroup col")].map((col) =>
      parseFloat((col as HTMLElement).style.width),
    );
    expect(widths).toHaveLength(ALL_COLUMNS.length);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1250);
  });

  it("clips every cell rather than letting it spill into the next column", () => {
    const { container } = table();
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  it("dims the previous filter's rows while the new ones load", () => {
    const { container } = table([product()], { stale: true });
    expect(container.querySelector("tbody")?.className).toMatch(/opacity-/);
    expect(container.querySelector("table")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the headers and says so in a row when nothing matches", () => {
    const { headers } = table([], { empty: "No items match" });
    expect(headers()).toEqual(ALL_COLUMNS);
    expect(screen.getByText("No items match")).toBeInTheDocument();
  });
});
