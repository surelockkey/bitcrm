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
  const headers = () => [...utils.container.querySelectorAll("thead th")].map((th) => th.textContent);
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

  it("says 0 for a template no van uses, and leaves no description blank", () => {
    const [, description, , , usedBy] = table([template({ description: undefined })], new Map()).cells();
    expect(description).toBe("");
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

  // Workiz's Locations: the red trash at the row's end — BitCRM archives.
  it("archives from the red trash, after asking", async () => {
    table();
    await userEvent.click(screen.getByRole("button", { name: "Archive Standard van" }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("t1", expect.anything());
  });

  it("restores an archived one, and offers no Apply for it", async () => {
    table([template({ status: InventoryStatus.ARCHIVED })]);
    expect(screen.queryByRole("button", { name: "Apply Standard van" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Restore Standard van" }));
    expect(mocks.restore).toHaveBeenCalledWith("t1");
  });

  it("has no trash for someone who may not archive", () => {
    mocks.denied.add("containers.delete");
    table();
    expect(screen.queryByRole("button", { name: "Archive Standard van" })).toBeNull();
  });
});

describe("TemplatesTable — a stable first frame", () => {
  it("is Workiz's grid: fixed layout, a drag handle on every header, the cells cut at their edge", () => {
    const { container } = table();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
    expect(container.querySelectorAll("colgroup col")).toHaveLength(6);
    for (const id of ["name", "description", "items", "units", "usedBy", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/overflow-hidden/);
    }
  });

  it("loading, is the same grid: header and widths, Workiz's loader over the blank rows", () => {
    const shape = () => ({
      headers: [...document.querySelectorAll("thead th")].map((th) => th.textContent),
      widths: [...document.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width),
    });
    const { unmount } = table();
    const loaded = shape();
    unmount();

    renderWithClient(<TemplatesTable templates={[]} usedBy={new Map()} onEdit={vi.fn()} onApply={vi.fn()} loading />);
    expect(shape()).toEqual(loaded);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
