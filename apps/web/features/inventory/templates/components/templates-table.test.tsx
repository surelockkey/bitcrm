import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  archive: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("../hooks", () => ({
  useArchiveTemplate: () => ({ mutate: mocks.archive, isPending: false }),
  useRestoreTemplate: () => ({ mutate: mocks.restore, isPending: false }),
}));

import { TemplatesTable } from "./templates-table";

const template = (over: Partial<ContainerTemplate> = {}): ContainerTemplate => ({
  id: "t1",
  name: "Standard van",
  description: "What every lockout van carries",
  items: [
    { productId: "p1", productName: "Deadbolt", sku: "LOCK-1", quantity: 4 },
    { productId: "p2", productName: "Key blank", sku: "KEY-7", quantity: 50 },
  ],
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => {
  mocks.denied = new Set();
  mocks.archive.mockReset();
  mocks.restore.mockReset();
});

function table(templates = [template()], usedBy = new Map([["t1", 3]])) {
  const onEdit = vi.fn();
  const onApply = vi.fn();
  const utils = renderWithClient(
    <TemplatesTable templates={templates} usedBy={usedBy} onEdit={onEdit} onApply={onApply} />,
  );
  const headers = () => [...utils.container.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
  const cells = () => [...utils.container.querySelectorAll("tbody tr:first-child td")].map((td) => td.textContent);
  return { ...utils, onEdit, onApply, headers, cells };
}

describe("TemplatesTable", () => {
  it("lists Name · Description · Items · Units · Used by · Actions", () => {
    expect(table().headers()).toEqual(["Name", "Description", "Items", "Units", "Used by", "Actions"]);
  });

  it("counts the lines, the units, and the vans using it", () => {
    const [name, description, items, units, usedBy] = table().cells();
    expect(name).toBe("Standard van");
    expect(description).toBe("What every lockout van carries");
    expect(items).toBe("2");
    expect(units).toBe("54");
    expect(usedBy).toBe("3");
  });

  it("says 0 for a template no van uses, — without a description", () => {
    const [, description, , , usedBy] = table([template({ description: undefined })], new Map()).cells();
    expect(description).toBe("—");
    expect(usedBy).toBe("0");
  });

  it("left-aligns everything", () => {
    const { container } = table();
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/text-right|justify-end/);
    }
  });

  it("opens Edit from the row and the pencil, Apply from its button", async () => {
    const { onEdit, onApply } = table();
    await userEvent.click(screen.getByText("Standard van"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Edit Standard van" }));
    expect(onEdit).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Apply Standard van" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("archives from the kebab, after asking", async () => {
    table();
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    await userEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Archive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("t1");
  });

  it("restores an archived one, and offers no Apply for it", async () => {
    table([template({ status: InventoryStatus.ARCHIVED })]);
    expect(screen.queryByRole("button", { name: "Apply Standard van" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    expect(mocks.restore).toHaveBeenCalledWith("t1");
  });

  it("has no kebab for someone who may not archive", () => {
    mocks.denied.add("containers.delete");
    table();
    expect(screen.queryByRole("button", { name: "Row actions" })).toBeNull();
  });
});

describe("TemplatesTable — a stable first frame", () => {
  it("is fixed-layout, resizable, fits 1250px, clips cells and scrolls sideways", () => {
    const { container } = table();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
    const cols = [...container.querySelectorAll("colgroup col")] as HTMLElement[];
    expect(cols).toHaveLength(6);
    expect(cols.reduce((n, c) => n + parseFloat(c.style.width), 0)).toBeLessThanOrEqual(1250);
    for (const id of ["name", "description", "items", "units", "usedBy", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
    expect(container.querySelector("[data-slot=table-frame]")?.className).toMatch(/overflow-x-auto/);
  });
});
