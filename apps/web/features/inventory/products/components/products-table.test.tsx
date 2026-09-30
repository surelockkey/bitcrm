import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { ProductsTable } from "./products-table";

const permissionReads = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => {
    permissionReads.n += 1;
    return { can: () => true };
  },
}));
vi.mock("../hooks", () => ({
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The photo popup has a suite of its own; here only who opens it matters.
vi.mock("./product-photo-dialog", () => ({
  ProductPhotoDialog: ({ product }: { product: { id: string } | null }) =>
    product ? <div data-testid="photo-preview" data-id={product.id} /> : null,
}));

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 1042,
    sku: "LOCK-001",
    name: "Deadbolt",
    description: "Grade 2 single-cylinder deadbolt, satin nickel",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    onHand: 369,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function table(
  products: Product[] = [product()],
  over: Partial<Parameters<typeof ProductsTable>[0]> = {},
) {
  const onEdit = vi.fn();
  const onStock = vi.fn();
  const utils = renderWithClient(
    <ProductsTable products={products} showCost onEdit={onEdit} onStock={onStock} {...over} />,
  );
  const headers = () =>
    [...utils.container.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
  const cell = (column: string) => {
    const index = headers().indexOf(column);
    return utils.container.querySelectorAll("tbody tr:first-child td")[index] as HTMLElement;
  };
  return { ...utils, onEdit, onStock, headers, cell };
}

describe("ProductsTable — the Workiz columns", () => {
  it("lists Photo · Product ID · Name · Description · Price · Cost · Quantity · SKU · Category, then Actions", () => {
    expect(table().headers()).toEqual([
      "Photo",
      "Product ID",
      "Name",
      "Description",
      "Price",
      "Cost",
      "Quantity",
      "SKU",
      "Category",
      "Actions",
    ]);
  });

  it("leaves the Cost column out for someone who may not see money", () => {
    const { headers } = table([product()], { showCost: false });
    expect(headers()).not.toContain("Cost");
    expect(screen.queryByText("$10.00")).toBeNull();
  });

  it("left-aligns every header and cell — numbers and money included", () => {
    const { container } = table();
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/text-right|justify-end/);
    }
  });

  it("shows the product number as the Product ID, a dash without one", () => {
    const { cell, unmount } = table();
    expect(cell("Product ID")).toHaveTextContent("1042");
    unmount();
    expect(table([product({ number: undefined })]).cell("Product ID")).toHaveTextContent("—");
  });

  it("shows the price, the company cost, the SKU, the category and the description", () => {
    const { cell } = table();
    expect(cell("Price")).toHaveTextContent("$45.00");
    expect(cell("Cost")).toHaveTextContent("$10.00");
    expect(cell("SKU")).toHaveTextContent("LOCK-001");
    expect(cell("Category")).toHaveTextContent("Locks");
    expect(cell("Description")).toHaveTextContent("Grade 2 single-cylinder deadbolt");
  });

  it("keeps the description to one line", () => {
    expect(table().cell("Description").className).toMatch(/truncate/);
  });

  it("takes Quantity from onHand, 0 when the item has none yet", () => {
    const { cell, unmount } = table();
    expect(cell("Quantity")).toHaveTextContent("369");
    unmount();
    expect(table([product({ onHand: undefined })]).cell("Quantity")).toHaveTextContent(/^0$/);
  });

  // Workiz's first column: the item's picture, 40×40, beside its Product ID.
  it("shows the item's thumbnail first, a grey placeholder without one", () => {
    const { cell, unmount } = table([product({ thumbnailUrl: "https://cdn.test/p1.webp", photoKey: "k" } as Partial<Product>)]);
    expect(cell("Photo").querySelector("img")).toHaveAttribute("src", "https://cdn.test/p1.webp");
    unmount();
    expect(table().cell("Photo").querySelector("[data-testid=photo-placeholder]")).not.toBeNull();
  });

  it("opens the photo from the thumbnail — not the item's Edit popup", async () => {
    const { onEdit } = table([product({ thumbnailUrl: "https://cdn.test/p1.webp", photoKey: "k" } as Partial<Product>)]);
    await userEvent.click(screen.getByRole("button", { name: "View photo of Deadbolt" }));
    expect(screen.getByTestId("photo-preview")).toHaveAttribute("data-id", "p1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  // A 40px picture in a 48px row: the cell trims its padding instead of growing the row.
  it("keeps the photo inside the row's height", () => {
    expect(table().cell("Photo").className).toMatch(/(^|\s)py-1(\s|$)/);
  });

  it("has no checkbox column", () => {
    table();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("ProductsTable — actions", () => {
  it("opens the Edit popup from the pencil", async () => {
    const { onEdit } = table();
    await userEvent.click(screen.getByRole("button", { name: "Edit Deadbolt" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("opens Manage stock from the stock button", async () => {
    const { onStock, onEdit } = table();
    await userEvent.click(screen.getByRole("button", { name: "Manage stock for Deadbolt" }));
    expect(onStock).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the Edit popup on a row click", async () => {
    const { onEdit } = table();
    await userEvent.click(screen.getByText("Deadbolt"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("keeps Archive in the kebab, and no Edit/View item there", async () => {
    table();
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /edit|view/i })).toBeNull();
  });

  it("offers Restore for an archived item", async () => {
    table([product({ status: InventoryStatus.ARCHIVED })]);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    expect(await screen.findByRole("menuitem", { name: "Restore" })).toBeInTheDocument();
  });
});

/**
 * Довга назва товару розсувала колонку «Item» на 739 із 1182 пікселів
 * контейнера — таблиця вилазила за рамку, а браузер, ділячи ширину, стискав
 * найменшу колонку: галочки з'їжджали на рамку й наліво від неї.
 *
 * Тепер ширину задає колонка, а не вміст: `table-fixed` плюс `<colgroup>` —
 * і межу можна перетягнути, а таблиця цю ширину пам'ятає.
 */
describe("ProductsTable — a stable first frame", () => {
  const longName =
    "Don-Jo - Mortise Remodeler Kit #109 - 630 - Silver (RPK-109-630) (SLK-12359)";

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = table();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // Ширина живе в одному місці — в колонці. `min-w` на комірці б'є оголошену
  // ширину й зсуває рядок убік, хоч би що казав `<colgroup>`.
  it("leaves the width to the column — no cell sets one of its own", () => {
    const { container } = table([product({ name: longName })]);
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/(^|\s)(min-)?w-/);
    }
  });

  // Під `table-fixed` комірка, яка не ріже вміст, не розширює колонку — вона
  // вилазить на сусідню.
  it("clips every cell rather than letting it spill into the next column", () => {
    const { container } = table([product({ name: longName })]);
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  // У браузері на 1600px колонка Actions обрізалась до «Actio», а кнопка
  // Manage stock зникала: сума ширин (1430) не влазила в ~1250px вмісту.
  it("fits a ~1250px content area at its default widths, Cost column included", () => {
    const { container } = table();
    const widths = [...container.querySelectorAll("colgroup col")].map((col) =>
      parseFloat((col as HTMLElement).style.width),
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1250);
  });

  // Ширше за екран (перетягнута межа, вузьке вікно) — прокрутка вбік, а не
  // обрізана остання колонка.
  it("scrolls sideways instead of clipping when the columns outgrow the screen", () => {
    const { container } = table();
    const frame = container.querySelector("[data-slot=table-frame]") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toMatch(/overflow-x-auto/);
    expect(frame.className).not.toMatch(/overflow-hidden/);
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of [
      "photo",
      "productId",
      "name",
      "description",
      "price",
      "cost",
      "quantity",
      "sku",
      "category",
      "actions",
    ]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

describe("ProductsTable — loading and waiting", () => {
  it("loading, has the same columns at the same widths as the loaded table", () => {
    const shape = (c: HTMLElement) => ({
      headers: [...c.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label")),
      widths: [...c.querySelectorAll("col")].map((col) => (col as HTMLElement).style.width),
    });
    const loaded = table();
    const want = shape(loaded.container);
    loaded.unmount();

    const skeleton = table([], { loading: true, skeletonRows: 50 });
    expect(shape(skeleton.container)).toEqual(want);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(50);
  });

  it("keeps the Cost column while it is not yet known whether money may be shown", () => {
    const { headers } = table([product()], { showCost: "pending" });
    expect(headers()).toContain("Cost");
    expect(screen.queryByText("$10.00")).toBeNull();
  });

  // A hundred rows used to mean a hundred subscriptions to the current user,
  // two hundred mutations and a hundred confirm dialogs.
  it("reads the permissions once for the table, not once per row", () => {
    permissionReads.n = 0;
    table(Array.from({ length: 100 }, (_, i) => product({ id: `p${i}`, name: `Item ${i}` })));
    expect(permissionReads.n).toBeLessThan(5);
  });
});
