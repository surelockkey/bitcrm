import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "@/features/inventory/stock/lib";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  locations: [] as StockLocation[],
  locationsEnabled: [] as boolean[],
}));

vi.mock("@/features/inventory/stock/hooks", async (importOriginal) => ({
  // The source's stock is read for real, through MSW.
  useLocationStock: (await importOriginal<typeof import("@/features/inventory/stock/hooks")>()).useLocationStock,
  useAllLocations: (enabled = true) => {
    mocks.locationsEnabled.push(enabled);
    return { data: mocks.locations, isLoading: false, isError: false };
  },
  useMoveStock: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { NewTransferDialog } from "./new-transfer-dialog";

const active = InventoryStatus.ACTIVE;

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.locationsEnabled = [];
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    { type: "warehouse", id: "w2", name: "Overflow", status: active },
    { type: "container", id: "c1", name: "Taras's van", status: active, department: "North" },
    { type: "container", id: "c150", name: "Pavlo's van", status: active },
  ];
});

async function pick(combobox: number, option: string | RegExp) {
  await userEvent.click(screen.getAllByRole("combobox")[combobox]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("NewTransferDialog", () => {
  // The Transfers tab mounts it closed; it shouldn't page through every
  // warehouse and van until someone opens it.
  it("loads the locations only while open", () => {
    const { rerender } = renderWithClient(<NewTransferDialog open={false} onOpenChange={() => {}} />);
    expect(mocks.locationsEnabled.length).toBeGreaterThan(0);
    expect(new Set(mocks.locationsEnabled)).toEqual(new Set([false]));

    mocks.locationsEnabled = [];
    rerender(<NewTransferDialog open onOpenChange={() => {}} />);
    expect(mocks.locationsEnabled.length).toBeGreaterThan(0);
    expect(new Set(mocks.locationsEnabled)).toEqual(new Set([true]));
  });

  it("offers every location as a source", async () => {
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Main", "Overflow", "Taras's van · North", "Pavlo's van"]);
  });

  it("allows warehouse → warehouse, never a location to itself", async () => {
    server.use(
      http.get("*/inventory/stock/locations/warehouse/w1", () =>
        HttpResponse.json({
          success: true,
          data: { locationType: "warehouse", locationId: "w1", name: "Main", status: active, rows: [] },
        }),
      ),
    );
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await pick(0, "Main");
    await userEvent.click(screen.getAllByRole("combobox")[1]);
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Overflow", "Taras's van · North", "Pavlo's van"]);
  });

  // The source's stock is the location view every movement refreshes: a
  // copy under a key of its own showed the old on-hand for 30s after a move.
  it("moves the chosen stock through the move endpoint", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/inventory/stock/locations/container/c1", ({ request }) => {
        asked.push(new URL(request.url).pathname);
        return HttpResponse.json({
          success: true,
          data: {
            locationType: "container",
            locationId: "c1",
            name: "Taras's van",
            status: active,
            rows: [{ productId: "p1", productName: "Deadbolt", quantity: 5 }],
          },
        });
      }),
    );
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await pick(0, /Taras/);
    await pick(1, "Pavlo's van");
    await userEvent.type(screen.getByPlaceholderText(/Add a product/), "Dead");
    await userEvent.click(await screen.findByRole("button", { name: /Deadbolt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create transfer" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        fromType: "container",
        fromId: "c1",
        toType: "container",
        toId: "c150",
        items: [{ productId: "p1", productName: "Deadbolt", quantity: 1 }],
        notes: undefined,
      },
      expect.anything(),
    );
    expect(asked).toHaveLength(1);
  });
});
