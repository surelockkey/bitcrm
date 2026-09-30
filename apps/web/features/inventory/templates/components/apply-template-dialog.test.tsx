import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplateDiff, ContainerTemplateDiffLine } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { ApiError } from "@/lib/api/errors";
import type { StockLocation } from "@/features/inventory/stock/lib";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  locations: [] as StockLocation[],
  diff: undefined as unknown as {
    data?: ContainerTemplateDiff;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    dataUpdatedAt: number;
    refetch: () => void;
  },
  diffArgs: [] as [string | undefined, string | undefined, string | undefined][],
  /** Whether each comparison was allowed to run. */
  diffEnabled: [] as (boolean | undefined)[],
  locationsLoading: false,
  fill: vi.fn(),
  /** Whether the fill "succeeds" (calls onSuccess) — off to model one in flight. */
  settle: true,
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: mocks.locationsLoading ? [] : mocks.locations,
    isLoading: mocks.locationsLoading,
    isError: false,
  }),
}));
vi.mock("../hooks", () => ({
  useContainerTemplate: () => ({
    data: { id: "t1", name: "Standard van", items: [], status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" },
    isLoading: false,
    isError: false,
  }),
  useTemplateDiff: (id?: string, containerId?: string, warehouseId?: string, enabled?: boolean) => {
    mocks.diffArgs.push([id, containerId, warehouseId]);
    mocks.diffEnabled.push(enabled);
    return mocks.diff;
  },
  useFillFromWarehouse: () => ({
    isPending: false,
    mutate: ((vars, opts) => {
      mocks.fill(vars);
      if (mocks.settle) opts?.onSuccess?.();
    }) as Mutate,
  }),
}));

import { ApplyTemplateDialog } from "./apply-template-dialog";

const active = InventoryStatus.ACTIVE;
const line = (over: Partial<ContainerTemplateDiffLine>): ContainerTemplateDiffLine => ({
  productId: "p1",
  productName: "Deadbolt",
  sku: "LOCK-1",
  target: 4,
  onHand: 1,
  missing: 3,
  available: 10,
  willMove: 3,
  ...over,
});
const diffOf = (lines: ContainerTemplateDiffLine[]): ContainerTemplateDiff => ({
  templateId: "t1",
  templateName: "Standard van",
  containerId: "c1",
  containerName: "Van 1",
  warehouseId: "w2",
  warehouseName: "Main",
  lines,
  shortLineCount: lines.filter((l) => l.missing > 0).length,
  missingUnits: lines.reduce((n, l) => n + l.missing, 0),
});

let uuid = 0;
beforeEach(() => {
  uuid = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `id-${++uuid}` as `${string}-${string}-${string}-${string}-${string}`);
  mocks.denied = new Set();
  mocks.fill.mockReset();
  mocks.settle = true;
  mocks.diffArgs = [];
  mocks.diffEnabled = [];
  mocks.locationsLoading = false;
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Overflow", status: active },
    { type: "warehouse", id: "w2", name: "Main", status: active, isPrimary: true },
    { type: "warehouse", id: "w9", name: "Closed", status: InventoryStatus.ARCHIVED },
    { type: "container", id: "c1", name: "Van 1", status: active },
    { type: "container", id: "c2", name: "Van 2", status: active },
  ];
  mocks.diff = {
    data: diffOf([
      line({}),
      line({ productId: "p2", productName: "Key blank", sku: "KEY-7", target: 50, onHand: 30, missing: 20, available: 5, willMove: 5 }),
      line({ productId: "p3", productName: "Strike plate", sku: "STR-1", target: 2, onHand: 5, missing: 0, available: 0, willMove: 0 }),
    ]),
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1000,
    refetch: vi.fn(),
  };
});
afterEach(() => vi.restoreAllMocks());

function open(containerId: string | null = "c1") {
  const onOpenChange = vi.fn();
  const onContainerChange = vi.fn();
  const utils = renderWithClient(
    <ApplyTemplateDialog
      templateId="t1"
      containerId={containerId}
      open
      onOpenChange={onOpenChange}
      onContainerChange={onContainerChange}
    />,
  );
  return { ...utils, onOpenChange, onContainerChange };
}

const rows = () =>
  [...document.querySelectorAll('[role="dialog"] tbody tr')].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent),
  );
const fill = () => screen.getByRole("button", { name: "Fill from warehouse" });

describe("ApplyTemplateDialog — the van against the template", () => {
  it("is titled with the template, the van passed in and the primary warehouse picked", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Apply Standard van" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Container" })).toHaveTextContent("Van 1");
    expect(screen.getByRole("combobox", { name: "Warehouse" })).toHaveTextContent("Main");
    expect(mocks.diffArgs.at(-1)).toEqual(["t1", "c1", "w2"]);
  });

  it("takes the first active warehouse when none is primary", () => {
    mocks.locations = mocks.locations.map((l) => ({ ...l, isPrimary: undefined }));
    open();
    expect(screen.getByRole("combobox", { name: "Warehouse" })).toHaveTextContent("Overflow");
    expect(mocks.diffArgs.at(-1)).toEqual(["t1", "c1", "w1"]);
  });

  it("lists Item · SKU · Target · On hand · Missing · In warehouse · Will move, left-aligned", () => {
    open();
    expect([...document.querySelectorAll('[role="dialog"] thead th')].map((th) => th.textContent)).toEqual([
      "Item",
      "SKU",
      "Target",
      "On hand",
      "Missing",
      "In warehouse",
      "Will move",
    ]);
    expect(rows()[0]).toEqual(["Deadbolt", "LOCK-1", "4", "1", "3", "10", "3"]);
    for (const cell of document.querySelectorAll('[role="dialog"] th, [role="dialog"] td')) {
      expect(cell.className).not.toMatch(/text-right/);
    }
  });

  it("highlights what is missing and flags a line the warehouse can't cover", () => {
    open();
    const [deadbolt, keys, plates] = [...document.querySelectorAll('[role="dialog"] tbody tr')] as HTMLElement[];
    expect(deadbolt.getAttribute("data-missing")).toBe("true");
    expect(plates.getAttribute("data-missing")).toBe("false");
    expect(within(keys).getByText("short")).toBeInTheDocument();
    expect(within(deadbolt).queryByText("short")).toBeNull();
  });

  it("sums it up", () => {
    open();
    expect(screen.getByText("2 lines missing, 23 units; 8 units will move")).toBeInTheDocument();
  });

  it("asks again for another van, and says so to the URL", async () => {
    const { onContainerChange } = open();
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
    await userEvent.click(screen.getByRole("option", { name: /Van 2/ }));
    expect(mocks.diffArgs.at(-1)).toEqual(["t1", "c2", "w2"]);
    expect(onContainerChange).toHaveBeenCalledWith("c2");
  });

  it("offers only active warehouses", async () => {
    open();
    await userEvent.click(screen.getByRole("combobox", { name: "Warehouse" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Overflow", "Main"]);
  });

  it("waits for a van when none was passed in", () => {
    open(null);
    expect(screen.getByRole("combobox", { name: "Container" })).toHaveTextContent("Pick a container");
    expect(screen.getByText("Pick a van to compare with the template.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill from warehouse" })).toBeNull();
  });
});

describe("ApplyTemplateDialog — Fill from warehouse", () => {
  it("moves what will move, in one yellow click", async () => {
    open();
    expect(fill()).toHaveAttribute("data-variant", "default");
    await userEvent.click(fill());
    expect(mocks.fill).toHaveBeenCalledWith({
      id: "t1",
      body: { containerId: "c1", warehouseId: "w2", requestId: "id-1" },
      containerName: "Van 1",
    });
  });

  // A double click is one fill: both carry the same request id, and the
  // server moves stock once for it.
  it("sends the same request id for a double click", async () => {
    mocks.settle = false;
    open();
    await userEvent.dblClick(fill());
    const ids = mocks.fill.mock.calls.map(([vars]) => (vars as { body: { requestId: string } }).body.requestId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids)).toEqual(new Set(["id-1"]));
  });

  it("uses a fresh request id after a fill went through", async () => {
    open();
    await userEvent.click(fill());
    await userEvent.click(fill());
    const ids = mocks.fill.mock.calls.map(([vars]) => (vars as { body: { requestId: string } }).body.requestId);
    expect(ids).toEqual(["id-1", "id-2"]);
  });

  it("uses a fresh request id when the comparison is read again", async () => {
    const { rerender } = open();
    mocks.diff = { ...mocks.diff, dataUpdatedAt: 2000 };
    rerender(<ApplyTemplateDialog templateId="t1" containerId="c1" open onOpenChange={vi.fn()} />);
    await userEvent.click(fill());
    expect((mocks.fill.mock.calls[0][0] as { body: { requestId: string } }).body.requestId).toBe("id-2");
  });

  it("is off when nothing will move", () => {
    mocks.diff = { ...mocks.diff, data: diffOf([line({ missing: 3, available: 0, willMove: 0 })]) };
    open();
    expect(fill()).toBeDisabled();
  });

  it("is not offered to someone who may not move stock", () => {
    mocks.denied.add("transfers.create");
    open();
    expect(screen.queryByRole("button", { name: "Fill from warehouse" })).toBeNull();
  });
});

describe("ApplyTemplateDialog — what the server refused", () => {
  it("explains a 403 in words", () => {
    mocks.diff = { ...mocks.diff, data: undefined, isError: true, error: new ApiError(403, "Forbidden") };
    open();
    expect(screen.getByText("You don't have access to this van or warehouse.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says what is gone on a 404", () => {
    mocks.diff = { ...mocks.diff, data: undefined, isError: true, error: new ApiError(404, "Not found") };
    open();
    expect(screen.getByText("The template, van or warehouse no longer exists.")).toBeInTheDocument();
  });

  // Without warehouses.view there is no warehouse to fill from: the
  // comparison still shows, the fill doesn't.
  it("compares without a warehouse when none can be seen", () => {
    mocks.locations = mocks.locations.filter((l) => l.type === "container");
    mocks.diff = {
      ...mocks.diff,
      data: diffOf([line({ available: undefined, willMove: undefined })]),
    };
    open();
    expect(mocks.diffArgs.at(-1)).toEqual(["t1", "c1", undefined]);
    expect(rows()[0]).toEqual(["Deadbolt", "LOCK-1", "4", "1", "3", "—", "—"]);
    expect(screen.getByText("No warehouse to fill from.")).toBeInTheDocument();
    expect(fill()).toBeDisabled();
  });
});

/**
 * The warehouse is picked from the locations. Asked before they arrived, the
 * comparison ran once without a warehouse and again with one: skeleton,
 * table, skeleton, table — in a centred popup, so both edges moved.
 */
describe("ApplyTemplateDialog — one comparison, one height", () => {
  it("waits for the locations before comparing, so it compares once, with the warehouse", () => {
    mocks.locationsLoading = true;
    renderWithClient(
      <ApplyTemplateDialog templateId="t1" containerId="c1" open onOpenChange={vi.fn()} />,
    );
    expect(mocks.diffEnabled.length).toBeGreaterThan(0);
    expect(mocks.diffEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it("is the same height comparing and compared", () => {
    mocks.diff = { ...mocks.diff, data: undefined, isLoading: true };
    const { unmount } = renderWithClient(
      <ApplyTemplateDialog templateId="t1" containerId="c1" open onOpenChange={vi.fn()} />,
    );
    const loading = screen.getByRole("dialog").className;
    expect(screen.getByTestId("apply-loading")).toBeInTheDocument();
    unmount();

    mocks.diff = { ...mocks.diff, data: diffOf([line({})]), isLoading: false };
    renderWithClient(<ApplyTemplateDialog templateId="t1" containerId="c1" open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog").className).toBe(loading);
    expect(loading).toMatch(/(^|\s)h-\[/);
  });

  it("comparing, draws the table's own header over placeholder rows", () => {
    mocks.diff = { ...mocks.diff, data: undefined, isLoading: true };
    renderWithClient(<ApplyTemplateDialog templateId="t1" containerId="c1" open onOpenChange={vi.fn()} />);
    const panel = screen.getByTestId("apply-loading");
    expect(within(panel).getAllByRole("columnheader").map((th) => th.textContent)).toContain("Will move");
    expect(within(panel).getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });
});
