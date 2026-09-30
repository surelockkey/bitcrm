import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Brand } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

type Row = Brand;
type Call = { kind: string; body: unknown; id?: string };

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  loading: false,
  enabled: [] as { kind: string; enabled: boolean }[],
  creates: [] as Call[],
  updates: [] as Call[],
  denied: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: mocks.back }),
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
    return { data: mocks.loading ? undefined : mocks.rows, isLoading: mocks.loading, isError: false };
  };
  return { useItemCategories: list("categories"), useBrands: list("brands") };
});
vi.mock("../hooks", () => ({
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

const row = (id: string, name: string, active = true): Row => ({
  id,
  name,
  active,
  createdBy: "",
  createdAt: "",
  updatedAt: "",
});

const KINDS = [
  {
    kind: "categories",
    Page: CategoriesPage,
    path: "/price-book/categories",
    resource: "product_categories",
    noun: "category",
    Noun: "Category",
    names: ["Locks", "Keys", "Retired"],
  },
  {
    kind: "brands",
    Page: BrandsPage,
    path: "/price-book/brands",
    resource: "brands",
    noun: "brand",
    Noun: "Brand",
    names: ["Schlage", "Kwikset", "Retired"],
  },
] as const;

beforeEach(() => {
  mocks.loading = false;
  mocks.enabled = [];
  mocks.creates = [];
  mocks.updates = [];
  mocks.denied = new Set();
  window.history.replaceState(null, "", "/");
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.back.mockReset();
});

describe.each(KINDS)("$Noun tab", ({ kind, Page, path, resource, noun, Noun, names }) => {
  beforeEach(() => {
    mocks.rows = [row("r1", names[0]), row("r2", names[1]), row("r3", names[2], false)];
  });

  const headers = (container: HTMLElement) =>
    [...container.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
  const rowNames = (container: HTMLElement) =>
    [...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);

  it("lists Name · Status · Actions — the API has no parent, description or item count", () => {
    const { container } = renderWithClient(<Page />);
    expect(headers(container)).toEqual(["Name", "Status", "Actions"]);
  });

  it(`reads the whole ${noun} catalog once, with ${resource}.view, sorted by name`, () => {
    const { container } = renderWithClient(<Page />);
    expect(mocks.enabled.every((e) => e.kind === kind && e.enabled)).toBe(true);
    expect(rowNames(container)).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("says Active or Archived, left-aligned", () => {
    const { container } = renderWithClient(<Page />);
    const archived = [...container.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent?.includes("Retired"),
    )!;
    expect(archived).toHaveTextContent("Archived");
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/text-right|justify-end|text-center/);
    }
  });

  it("searches the loaded list in place", async () => {
    const { container } = renderWithClient(<Page />);
    await userEvent.type(screen.getByPlaceholderText(`Search ${noun === "category" ? "categories" : "brands"}`), names[1].slice(0, 3).toLowerCase());
    expect(rowNames(container)).toEqual([names[1]]);
  });

  it("draws the skeleton as the table itself while the catalog loads", () => {
    mocks.loading = true;
    const { container } = renderWithClient(<Page />);
    const skeleton = screen.getAllByTestId("skeleton-row");
    expect(skeleton[0].querySelectorAll("td")).toHaveLength(headers(container).length);
  });

  it("stays a skeleton, not an empty catalog, while its query waits on permissions", () => {
    // A disabled query: no data, and not "loading" in TanStack's sense.
    mocks.rows = undefined as unknown as Row[];
    renderWithClient(<Page />);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByText(/yet$/)).toBeNull();
  });

  it(`opens New ${noun} from the one yellow button`, async () => {
    renderWithClient(<Page />);
    const button = screen.getByRole("button", { name: `New ${noun}` });
    expect(button).toHaveAttribute("data-variant", "default");
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: `New ${noun}` })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe(path);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it(`creates a ${noun} with exactly its name and active flag`, async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByRole("button", { name: `New ${noun}` }));
    const dialog = screen.getByRole("dialog", { name: `New ${noun}` });
    await userEvent.type(within(dialog).getByLabelText("Name"), "  Padlocks ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(mocks.creates).toEqual([{ kind, body: { name: "Padlocks", active: true } }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses a blank name without asking the server", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByRole("button", { name: `New ${noun}` }));
    const dialog = screen.getByRole("dialog", { name: `New ${noun}` });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(mocks.creates).toEqual([]);
    expect(within(dialog).getByText("Name is required")).toBeInTheDocument();
  });

  it("opens the Edit popup on a row click", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByText(names[0]));
    expect(within(screen.getByRole("dialog", { name: `Edit ${noun}` })).getByLabelText("Name")).toHaveValue(names[0]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("sends only what changed from the Edit popup", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByText(names[0]));
    const dialog = screen.getByRole("dialog", { name: `Edit ${noun}` });
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue(names[0]);
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([{ kind, id: "r1", body: { name: "Renamed" } }]);
  });

  it("archives from the Edit popup's Active switch", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByText(names[0]));
    const dialog = screen.getByRole("dialog", { name: `Edit ${noun}` });
    await userEvent.click(within(dialog).getByRole("switch", { name: "Active" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([{ kind, id: "r1", body: { active: false } }]);
  });

  it("closes without a request when nothing changed", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByText(names[0]));
    const dialog = screen.getByRole("dialog", { name: `Edit ${noun}` });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updates).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // Popups are state now; an old link with the popup in its query still opens it.
  it(`opens an old ?edit= link's popup, then takes it out of the address`, () => {
    window.history.replaceState(null, "", `${path}?edit=r1`);
    renderWithClient(<Page />);
    expect(screen.getByRole("dialog", { name: `Edit ${noun}` })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe(path);
  });

  it(`says so when an old ?edit= link names no ${noun}`, () => {
    window.history.replaceState(null, "", `${path}?edit=nope`);
    renderWithClient(<Page />);
    expect(screen.getByRole("dialog", { name: `${Noun} not found` })).toBeInTheDocument();
  });

  it("archives from the kebab after a confirm, with active: false", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${names[0]}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(mocks.updates).toEqual([]);
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(mocks.updates).toEqual([{ kind, id: "r1", body: { active: false } }]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("restores an archived one from the kebab, with active: true", async () => {
    renderWithClient(<Page />);
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${names[2]}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    expect(mocks.updates).toEqual([{ kind, id: "r3", body: { active: true } }]);
  });

  it(`hides New ${noun} without ${resource}.create`, () => {
    mocks.denied = new Set([`${resource}.create`]);
    renderWithClient(<Page />);
    expect(screen.queryByRole("button", { name: `New ${noun}` })).toBeNull();
  });

  it(`offers no edit, archive or row click without ${resource}.edit`, async () => {
    mocks.denied = new Set([`${resource}.edit`]);
    renderWithClient(<Page />);
    expect(screen.queryByRole("button", { name: `Edit ${names[0]}` })).toBeNull();
    expect(screen.queryByRole("button", { name: `Actions for ${names[0]}` })).toBeNull();
    await userEvent.click(screen.getByText(names[0]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it(`refuses without ${resource}.view`, () => {
    mocks.denied = new Set([`${resource}.view`]);
    renderWithClient(<Page />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(mocks.enabled.every((e) => !e.enabled)).toBe(true);
  });
});

describe("renaming a category", () => {
  it("warns that items filed under the old name keep it", async () => {
    mocks.rows = [row("r1", "Locks")];
    renderWithClient(<CategoriesPage />);
    await userEvent.click(screen.getByText("Locks"));
    const dialog = screen.getByRole("dialog", { name: "Edit category" });
    expect(within(dialog).queryByText(/keep/i)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Name"), "s");
    expect(within(dialog).getByText(/Items filed under “Locks” keep that name/)).toBeInTheDocument();
  });
});
