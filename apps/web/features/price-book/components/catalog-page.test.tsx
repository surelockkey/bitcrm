import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/render-with-client";
import type { CatalogEntry } from "../lib";

type Call = { kind: string; body: unknown; id?: string };

const mocks = vi.hoisted(() => ({
  rows: [] as CatalogEntry[] | undefined,
  loading: false,
  enabled: [] as { kind: string; enabled: boolean }[],
  counted: [] as { names: readonly string[]; enabled: boolean }[],
  creates: [] as Call[],
  updates: [] as Call[],
  denied: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  csv: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/price-book",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("@/features/inventory/products/hooks", () => {
  const list = (kind: string) => (enabled: boolean) => {
    mocks.enabled.push({ kind, enabled });
    return {
      data: mocks.loading ? undefined : mocks.rows,
      isLoading: mocks.loading,
      isPending: mocks.loading || mocks.rows === undefined,
      fetchStatus: mocks.loading ? "fetching" : "idle",
      isError: false,
    };
  };
  return { useItemCategories: list("categories"), useBrands: list("brands") };
});
vi.mock("../hooks", () => ({
  useCategoryItemCounts: (names: readonly string[], enabled: boolean) => {
    mocks.counted.push({ names, enabled });
    return { counts: new Map([["Locks", 349], ["Platinum > Private", 0]]), isLoading: false };
  },
  useCreateCatalogEntry: (kind: string) => ({
    isPending: false,
    mutate: (body: unknown, opts?: { onSuccess?: (row: unknown) => void }) => {
      mocks.creates.push({ kind, body });
      opts?.onSuccess?.({ id: "created-1", name: "x", active: true });
    },
  }),
  useUpdateCatalogEntry: (kind: string) => ({
    isPending: false,
    mutate: ({ id, body }: { id: string; body: unknown }, opts?: { onSuccess?: () => void }) => {
      mocks.updates.push({ kind, id, body });
      opts?.onSuccess?.();
    },
  }),
}));

import { CategoriesPage } from "./categories-page";
import { BrandsPage } from "./brands-page";

const row = (id: string, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name,
  active: true,
  createdBy: "",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const grid = () => document.querySelector("[data-slot=wz-report-grid]") as HTMLElement;
const heads = () => [...grid().querySelectorAll("thead th")].map((th) => th.textContent);
const records = () => [...grid().querySelectorAll("tbody tr:not([aria-hidden])")];
const rowNames = () => records().map((tr) => tr.querySelector("td")?.textContent);
const rowOf = (name: string) => records().find((tr) => tr.querySelector("td")?.textContent === name) as HTMLElement;

const KINDS = [
  {
    kind: "categories",
    Page: CategoriesPage,
    resource: "product_categories",
    add: "Add new",
    createTitle: "Create new category",
    editTitle: "Edit category",
    nameLabel: "Category name",
    editTip: "Edit category",
    deleteTip: "Delete category",
    enable: "Enable category",
    names: ["Locks", "Keys", "Retired"],
  },
  {
    kind: "brands",
    Page: BrandsPage,
    resource: "brands",
    add: "Add New",
    createTitle: "Create new brand",
    editTitle: "Edit brand",
    nameLabel: "Brand name",
    editTip: "Edit",
    deleteTip: "Delete",
    enable: "Enable brand",
    names: ["Schlage", "Kwikset", "Retired"],
  },
] as const;

beforeEach(() => {
  mocks.loading = false;
  mocks.enabled = [];
  mocks.counted = [];
  mocks.creates = [];
  mocks.updates = [];
  mocks.denied = new Set();
  window.history.replaceState(null, "", "/");
  mocks.push.mockReset();
  mocks.replace.mockReset();
});

describe.each(KINDS)("$kind tab — Workiz's list", (k) => {
  beforeEach(() => {
    mocks.rows = [
      row("r1", k.names[0], { description: "The first one" }),
      row("r2", k.names[1]),
      row("r3", k.names[2], { active: false }),
    ];
  });

  it(`reads the whole catalog once, with ${k.resource}.view, and shows the active ones by name`, () => {
    renderWithClient(<k.Page />);
    expect(mocks.enabled.every((e) => e.kind === k.kind && e.enabled)).toBe(true);
    expect(rowNames()).toEqual([k.names[1], k.names[0]].sort((a, b) => a.localeCompare(b)));
    expect(screen.getByText("The first one")).toBeInTheDocument();
  });

  it("switches between Active, All and Disabled in Workiz's status box", async () => {
    renderWithClient(<k.Page />);
    const box = screen.getByRole("combobox", { name: "Status" });
    await userEvent.click(box);
    await userEvent.click(await screen.findByRole("option", { name: "Disabled" }));
    expect(rowNames()).toEqual(["Retired"]);
    await userEvent.click(box);
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    expect(rowNames()).toHaveLength(3);
  });

  it("searches the loaded catalog in place, and says No Records Found", async () => {
    renderWithClient(<k.Page />);
    await userEvent.type(screen.getByPlaceholderText("Search"), k.names[1].slice(0, 3).toLowerCase());
    expect(rowNames()).toEqual([k.names[1]]);
    await userEvent.clear(screen.getByPlaceholderText("Search"));
    await userEvent.type(screen.getByPlaceholderText("Search"), "zzqq");
    expect(rowNames()).toEqual([]);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("sorts on a header click, as react-table does", async () => {
    renderWithClient(<k.Page />);
    const before = rowNames();
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(rowNames()).toEqual([...before].sort((a, b) => a!.localeCompare(b!)));
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(rowNames()).toEqual([...before].sort((a, b) => b!.localeCompare(a!)));
  });

  it("pages ten at a time by default, with Workiz's pager", () => {
    mocks.rows = Array.from({ length: 12 }, (_, i) => row(`x${i}`, `Entry ${String(i).padStart(2, "0")}`));
    renderWithClient(<k.Page />);
    expect(records()).toHaveLength(10);
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Showing 1 to 10 of 12 results");
  });

  it("draws Workiz's grid under its loader while the catalog loads — and while its query waits on permissions", () => {
    mocks.loading = true;
    const { unmount } = renderWithClient(<k.Page />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    unmount();
    mocks.loading = false;
    mocks.rows = undefined;
    renderWithClient(<k.Page />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it(`opens ${k.createTitle} from Workiz's one yellow ${k.add}, the address untouched`, async () => {
    window.history.replaceState(null, "", "/price-book/x");
    renderWithClient(<k.Page />);
    const add = screen.getByRole("button", { name: k.add });
    expect(add).toHaveAttribute("data-variant", "default");
    await userEvent.click(add);
    expect(screen.getByRole("dialog", { name: k.createTitle })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/price-book/x");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("creates one with its name, description and enable switch", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByRole("button", { name: k.add }));
    const dialog = screen.getByRole("dialog", { name: k.createTitle });
    await userEvent.type(within(dialog).getByLabelText(k.nameLabel), "  Padlocks ");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /description/i }), "Hasps too");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.creates).toEqual([{ kind: k.kind, body: { name: "Padlocks", active: true, description: "Hasps too" } }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses a blank name without asking the server", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByRole("button", { name: k.add }));
    const dialog = screen.getByRole("dialog", { name: k.createTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.creates).toEqual([]);
    expect(within(dialog).getByText("Name is required")).toBeInTheDocument();
  });

  it(`opens ${k.editTitle} from the pencil (and the row), filled in`, async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(within(rowOf(k.names[0])).getByRole("button", { name: `${k.editTip} ${k.names[0]}` }));
    const dialog = screen.getByRole("dialog", { name: k.editTitle });
    expect(within(dialog).getByLabelText(k.nameLabel)).toHaveValue(k.names[0]);
    expect(within(dialog).getByRole("textbox", { name: /description/i })).toHaveValue("The first one");
    expect(within(dialog).getByRole("switch", { name: k.enable })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByText(k.names[1]));
    expect(within(screen.getByRole("dialog", { name: k.editTitle })).getByLabelText(k.nameLabel)).toHaveValue(k.names[1]);
  });

  it("sends only what changed from the Edit popup", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByText(k.names[0]));
    const dialog = screen.getByRole("dialog", { name: k.editTitle });
    const name = within(dialog).getByLabelText(k.nameLabel);
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: /description/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([{ kind: k.kind, id: "r1", body: { name: "Renamed", description: "" } }]);
  });

  it("disables and restores with the Enable switch", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByText(k.names[0]));
    let dialog = screen.getByRole("dialog", { name: k.editTitle });
    await userEvent.click(within(dialog).getByRole("switch", { name: k.enable }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([{ kind: k.kind, id: "r1", body: { active: false } }]);

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Disabled" }));
    await userEvent.click(screen.getByText("Retired"));
    dialog = screen.getByRole("dialog", { name: k.editTitle });
    await userEvent.click(within(dialog).getByRole("switch", { name: k.enable }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates.at(-1)).toEqual({ kind: k.kind, id: "r3", body: { active: true } });
  });

  it("closes without a request when nothing changed", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByText(k.names[0]));
    await userEvent.click(within(screen.getByRole("dialog", { name: k.editTitle })).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("archives from the trash after Workiz's confirm, with active: false", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(within(rowOf(k.names[1])).getByRole("button", { name: `${k.deleteTip} ${k.names[1]}` }));
    expect(mocks.updates).toEqual([]);
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Yes, delete" }));
    expect(mocks.updates).toEqual([{ kind: k.kind, id: "r2", body: { active: false } }]);
  });

  it("offers no trash on a disabled one — the Enable switch brings it back", async () => {
    renderWithClient(<k.Page />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Disabled" }));
    expect(within(rowOf("Retired")).queryByRole("button", { name: new RegExp(k.deleteTip) })).toBeNull();
  });

  // No deep links: an old link with the popup in its query lands on the plain list.
  it("opens nothing from an old ?edit= / ?new=1 link, and takes it out of the address", () => {
    window.history.replaceState(null, "", "/price-book/x?edit=r1");
    const { unmount } = renderWithClient(<k.Page />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname + window.location.search).toBe("/price-book/x");
    unmount();
    window.history.replaceState(null, "", "/price-book/x?new=1");
    renderWithClient(<k.Page />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname + window.location.search).toBe("/price-book/x");
  });

  it(`hides ${k.add} without ${k.resource}.create`, () => {
    mocks.denied = new Set([`${k.resource}.create`]);
    renderWithClient(<k.Page />);
    expect(screen.queryByRole("button", { name: k.add })).toBeNull();
  });

  it(`offers no edit, trash or row click without ${k.resource}.edit`, async () => {
    mocks.denied = new Set([`${k.resource}.edit`]);
    renderWithClient(<k.Page />);
    expect(within(rowOf(k.names[0])).queryAllByRole("button")).toHaveLength(0);
    await userEvent.click(screen.getByText(k.names[0]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it(`refuses without ${k.resource}.view`, () => {
    mocks.denied = new Set([`${k.resource}.view`]);
    renderWithClient(<k.Page />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(mocks.enabled.every((e) => !e.enabled)).toBe(true);
  });
});

describe("Item categories — Workiz's tree", () => {
  beforeEach(() => {
    mocks.rows = [
      row("p", "Platinum", { workizFilePath: "https://x.test/p.png" }),
      row("c", "Platinum > Private", { parentId: "p", description: "Only for Platinum" }),
      row("l", "Locks"),
      row("u", "Uncategorized"),
    ];
  });

  it("lays out Workiz's columns under its subtitle", () => {
    renderWithClient(<CategoriesPage />);
    expect(
      screen.getByText("Item categories help manage and streamline your items, making it easy to navigate your price book and inventory"),
    ).toBeInTheDocument();
    expect(heads()).toEqual(["Name", "Description", "Parent category", "No. of active items", "Actions"]);
  });

  it("prints each by its own name with its picture, its parent's own name and its active items; Uncategorized left out", () => {
    renderWithClient(<CategoriesPage />);
    expect(rowNames()).toEqual(["Locks", "Platinum", "Private"]);
    const cells = [...rowOf("Private").querySelectorAll("td")].map((td) => td.textContent);
    expect(cells.slice(0, 4)).toEqual(["Private", "Only for Platinum", "Platinum", "0"]);
    expect(rowOf("Locks").querySelectorAll("td")[3]).toHaveTextContent("349");
    expect(rowOf("Platinum").querySelector("img")).toHaveAttribute("src", "https://x.test/p.png");
    expect(rowOf("Locks").querySelector("svg rect")).toHaveAttribute("fill", "#ECEDEE");
  });

  it("greys the trash of a category holding items or sub-categories, with Workiz's reason — Enable category still turns it off", async () => {
    renderWithClient(<CategoriesPage />);
    const locked = (name: string) => within(rowOf(name)).getByRole("button", { name: `Delete category ${name}` });
    // Locks holds 349 items; Platinum holds Private. Private holds nothing.
    expect(locked("Locks")).toHaveAttribute("aria-disabled", "true");
    expect(locked("Platinum")).toHaveAttribute("aria-disabled", "true");
    expect(locked("Private")).not.toHaveAttribute("aria-disabled");
    await userEvent.hover(locked("Locks"));
    expect(
      (await screen.findAllByText("Categories containing sub-categories/items cannot be deleted")).length,
    ).toBeGreaterThan(0);
    await userEvent.click(locked("Locks"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("counts the items under every category's full name, with the catalog", () => {
    renderWithClient(<CategoriesPage />);
    expect(mocks.counted.at(-1)).toEqual({ names: ["Locks", "Platinum", "Platinum > Private"], enabled: true });
  });

  it("renames a sub-category by its own name and keeps its parents", async () => {
    renderWithClient(<CategoriesPage />);
    await userEvent.click(screen.getByText("Private"));
    const dialog = screen.getByRole("dialog", { name: "Edit category" });
    const name = within(dialog).getByLabelText("Category name");
    expect(name).toHaveValue("Private");
    await userEvent.clear(name);
    await userEvent.type(name, "Gold");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([{ kind: "categories", id: "c", body: { name: "Platinum > Gold" } }]);
  });

  it("exports the rows on show as CSV", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    renderWithClient(<CategoriesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(click).toHaveBeenCalled();
    const text = await blobs[0].text();
    expect(text.split("\n")[0]).toBe("Name,Description,Parent category,No. of active items");
    expect(text).toContain("Locks,,,349");
    click.mockRestore();
  });
});

describe("Item brands — Workiz's three columns", () => {
  beforeEach(() => {
    mocks.rows = [row("b1", "SLK", { description: "ALL ORDERS MADE BY SURE LOCK & KEY" }), row("b2", "UHS")];
  });

  it("is Name · Description · Actions, with no Export (Workiz has none here)", () => {
    renderWithClient(<BrandsPage />);
    expect(heads()).toEqual(["Name", "Description", "Actions"]);
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(rowOf("SLK")).toHaveTextContent("ALL ORDERS MADE BY SURE LOCK & KEY");
  });

  it("counts nothing", () => {
    renderWithClient(<BrandsPage />);
    expect(mocks.counted.every((c) => !c.enabled || c.names.length === 0)).toBe(true);
  });
});
