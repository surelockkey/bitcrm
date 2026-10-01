import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import type { LocationStockRow } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "@/features/inventory/stock/lib";
import type { DraftLine } from "../lib";

const LOCATIONS: StockLocation[] = [
  { type: "warehouse", id: "w1", name: "STORE", status: InventoryStatus.ACTIVE, isPrimary: true },
  { type: "warehouse", id: "w0", name: "Old shop", status: InventoryStatus.ARCHIVED },
  { type: "container", id: "c1", name: "Van 1", status: InventoryStatus.ACTIVE },
];
vi.mock("@/features/inventory/stock/hooks", async (original) => ({
  ...(await original<typeof import("@/features/inventory/stock/hooks")>()),
  useAllLocations: () => ({ data: LOCATIONS, isLoading: false, isError: false }),
}));

import { CopyFromLocationDialog } from "./copy-from-location-dialog";

const row = (productId: string, productName: string, quantity: number, over: Partial<LocationStockRow> = {}): LocationStockRow => ({
  productId,
  productName,
  number: 1000 + Number(productId.slice(1)),
  sku: `SKU-${productId}`,
  quantity,
  ...over,
});

let asked: string[] = [];
function serveStock(rows: LocationStockRow[]) {
  server.use(
    http.get("*/inventory/stock/locations/:type/:id", ({ params }) => {
      asked.push(`${params.type}/${params.id}`);
      return HttpResponse.json({
        success: true,
        data: { locationType: params.type, locationId: params.id, name: "STORE", status: "active", rows },
      });
    }),
  );
}

function renderDialog(current: DraftLine[] = []) {
  const onCopy = vi.fn();
  const onOpenChange = vi.fn();
  renderWithClient(<CopyFromLocationDialog open onOpenChange={onOpenChange} current={current} onCopy={onCopy} />);
  return { onCopy, onOpenChange, dialog: screen.getByRole("dialog", { name: "Copy from location" }) };
}

async function pick(name: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  asked = [];
});

describe("CopyFromLocationDialog", () => {
  it("offers the active warehouses and vans", async () => {
    serveStock([]);
    renderDialog();
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.some((n) => n.includes("STORE"))).toBe(true);
    expect(names.some((n) => n.includes("Van 1"))).toBe(true);
    expect(names.some((n) => n.includes("Old shop"))).toBe(false);
  });

  it("reads the location's stock in one request and says what it holds", async () => {
    serveStock([row("p1", "Deadbolt", 4), row("p2", "Key blank", 3)]);
    const { dialog } = renderDialog();
    await pick(/STORE/);
    await waitFor(() =>
      expect(within(dialog).getByTestId("copy-summary")).toHaveTextContent("STORE holds 2 products, 7 units."),
    );
    expect(asked).toEqual(["warehouse/w1"]);
  });

  it("copies straight into an empty template", async () => {
    serveStock([row("p1", "Deadbolt", 4), row("p2", "Key blank", 3)]);
    const { onCopy, onOpenChange } = renderDialog();
    await pick(/STORE/);
    await userEvent.click(await screen.findByRole("button", { name: "Copy 2 products" }));
    expect(onCopy).toHaveBeenCalledWith(
      [
        { productId: "p1", productName: "Deadbolt", sku: "SKU-p1", quantity: "4" },
        { productId: "p2", productName: "Key blank", sku: "SKU-p2", quantity: "3" },
      ],
      "replace",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks a template with lines: Replace them, or Merge — keep them and add the rest", async () => {
    serveStock([row("p1", "Deadbolt", 4), row("p2", "Key blank", 3)]);
    const current = [{ productId: "p2", productName: "Key blank", sku: "SKU-p2", quantity: "50" }];
    const { onCopy, dialog } = renderDialog(current);
    expect(within(dialog).queryByRole("button", { name: /^Copy/ })).toBeNull();
    await pick(/STORE/);
    await waitFor(() => expect(within(dialog).getByTestId("copy-summary")).toHaveTextContent("add the 1 product they lack"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    expect(onCopy).toHaveBeenLastCalledWith(expect.any(Array), "merge");
  });

  it("leaves out rows whose item is gone from the catalog, and says so", async () => {
    serveStock([row("p1", "Deadbolt", 4), row("p9", "Old thing", 2, { number: undefined, sku: undefined })]);
    const { dialog } = renderDialog();
    await pick(/STORE/);
    await waitFor(() => expect(within(dialog).getByTestId("copy-summary")).toHaveTextContent("1 row left out"));
    expect(within(dialog).getByRole("button", { name: "Copy 1 product" })).toBeEnabled();
  });

  it("warns when the location holds more than a template takes", async () => {
    serveStock(Array.from({ length: 501 }, (_, i) => row(`p${i}`, `Item ${i}`, 1)));
    const { dialog } = renderDialog();
    await pick(/STORE/);
    await waitFor(() => expect(within(dialog).getByTestId("copy-summary")).toHaveTextContent("500 products at most"));
  });

  it("has nothing to copy from an empty location", async () => {
    serveStock([]);
    const { dialog } = renderDialog();
    await pick(/Van 1/);
    await waitFor(() => expect(within(dialog).getByTestId("copy-summary")).toHaveTextContent("holds nothing to copy"));
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(asked).toEqual(["container/c1"]);
  });
});
