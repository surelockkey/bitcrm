import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope, InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { Container, UserContainer } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import type { ContainerFilter } from "../api";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  listFilters: [] as ContainerFilter[],
  countFilters: [] as ContainerFilter[],
  rows: [] as Container[],
  locations: [] as StockLocation[],
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  scope: "all" as string,
  assignments: [] as UserContainer[],
  namesAskedFor: [] as string[][],
  permsLoading: false,
  list: { isLoading: false, isPlaceholderData: false, noData: false },
  locationsLoading: false,
  prefetched: [] as (string | null)[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/inventory/containers",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: () => !mocks.permsLoading,
    scopeOf: () => (mocks.permsLoading ? null : mocks.scope),
    isLoading: mocks.permsLoading,
  }),
}));
vi.mock("../hooks", () => ({
  useContainersList: (filter: ContainerFilter) => {
    mocks.listFilters.push(filter);
    return {
      data: mocks.list.noData ? undefined : { pages: [{ data: mocks.rows, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: mocks.list.isLoading,
      isPlaceholderData: mocks.list.isPlaceholderData,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useContainersCount: (filter: ContainerFilter) => {
    mocks.countFilters.push(filter);
    return { data: { total: 93, atLeast: false } };
  },
  usePrefetchVanStock: (id: string | null) => {
    mocks.prefetched.push(id);
  },
  useContainerStockView: () => ({
    summary: { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: mocks.locationsLoading ? [] : mocks.locations,
    isLoading: mocks.locationsLoading,
    isError: false,
  }),
}));
vi.mock("@/features/inventory/user-containers/hooks", () => ({
  useUserContainers: () => ({ data: mocks.assignments, isLoading: false, isError: false }),
  useUserNames: (ids: string[]) => {
    mocks.namesAskedFor.push(ids);
    return { names: new Map([["u2", "Pavlo Bondar"]]), isLoading: false };
  },
}));
vi.mock("./container-create-dialog", () => ({ ContainerCreateDialog: () => null }));
vi.mock("./my-container-view", () => ({ MyContainerView: () => <div data-testid="my-van" /> }));
// The popups have suites of their own; here only which one the URL opens matters.
vi.mock("./container-edit-dialog", () => ({
  ContainerEditDialog: (props: { containerId: string; open: boolean; onOpenChange: (o: boolean) => void }) =>
    props.open ? (
      <div data-testid="edit-popup" data-id={props.containerId}>
        <button onClick={() => props.onOpenChange(false)}>close edit</button>
      </div>
    ) : null,
}));
vi.mock("@/features/inventory/stock/components/location-stock-dialog", () => ({
  LocationStockDialog: (props: {
    type: string;
    locationId: string;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    aside?: React.ReactNode;
  }) =>
    props.open ? (
      <div data-testid="stock-popup" data-type={props.type} data-id={props.locationId}>
        {props.aside}
        <button onClick={() => props.onOpenChange(false)}>close stock</button>
      </div>
    ) : null,
}));
vi.mock("@/features/inventory/templates/components/container-template-bar", () => ({
  ContainerTemplateBar: (props: { containerId: string; onApply: (id: string) => void; onSetTemplate: () => void }) => (
    <div data-testid="template-bar" data-id={props.containerId}>
      <button onClick={() => props.onApply("tp1")}>apply tp1</button>
      <button onClick={() => props.onSetTemplate()}>set template</button>
    </div>
  ),
}));
vi.mock("@/features/inventory/templates/components/apply-template-dialog", () => ({
  ApplyTemplateDialog: (props: { templateId: string; containerId: string | null; open: boolean }) =>
    props.open ? (
      <div data-testid="apply-popup" data-id={props.templateId} data-container={props.containerId ?? ""} />
    ) : null,
}));

import { ContainersPage } from "./containers-page";

function container(over: Partial<Container>): Container {
  return {
    id: "c1",
    name: "Van 1",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const active = InventoryStatus.ACTIVE;

beforeEach(() => {
  mocks.assignments = [];
  mocks.namesAskedFor = [];
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.scope = DataScope.ALL;
  mocks.permsLoading = false;
  mocks.prefetched = [];
  mocks.list = { isLoading: false, isPlaceholderData: false, noData: false };
  mocks.locationsLoading = false;
  mocks.listFilters = [];
  mocks.countFilters = [];
  mocks.rows = [container({ id: "c1", name: "Van Alpha" }), container({ id: "c2", name: "Van Zeta" })];
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    { type: "container", id: "c1", name: "Van Alpha", status: active, department: "South" },
    { type: "container", id: "c9", name: "Van 9", status: active, department: "North" },
    { type: "container", id: "c8", name: "Van 8", status: active, department: "North" },
  ];
});

describe("ContainersPage — the server filters, the page shows what it got", () => {
  it("sends the search to the server after a pause, and to the count as well", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.type(screen.getByPlaceholderText(/Search/), "alpha");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "alpha" }));
    expect(mocks.countFilters.at(-1)).toEqual(mocks.listFilters.at(-1));
    // Not one request per keystroke.
    expect(mocks.listFilters.some((f) => f.search === "alp")).toBe(false);
  });

  it("renders exactly the rows the server returned — no filtering in the browser", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.type(screen.getByPlaceholderText(/Search/), "alpha");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "alpha" }));
    expect(screen.getByText("Van Alpha")).toBeInTheDocument();
    expect(screen.getByText("Van Zeta")).toBeInTheDocument();
  });

  it("offers departments from every container, not just this page", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["All departments", "North", "South"]);
  });

  it("sends the department to the server", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    await userEvent.click(await screen.findByRole("option", { name: "North" }));
    expect(mocks.listFilters.at(-1)).toMatchObject({ department: "North" });
    expect(mocks.countFilters.at(-1)).toMatchObject({ department: "North" });
  });

  it("sends the status to the server", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Archived" }));
    expect(mocks.listFilters.at(-1)).toMatchObject({ status: InventoryStatus.ARCHIVED });
  });

  it("has no per-page 'N containers' label — the pager says how many", () => {
    renderWithClient(<ContainersPage />);
    expect(screen.queryByText(/^\d+ containers?$/)).toBeNull();
    expect(screen.getByText(/of 93/)).toBeInTheDocument();
  });
});

/**
 * A van may be shared: the Users column names everyone whose assignment row
 * points at it — and falls back to the old single technician only when none does.
 */
describe("ContainersPage — who works from each van", () => {
  const assignment = (userId: string, userName: string, containerId: string): UserContainer => ({
    userId,
    userName,
    access: UserContainerAccess.CONTAINER,
    containerId,
    limited: false,
    updatedAt: "",
  });

  it("names the users the assignments put on each van", () => {
    mocks.assignments = [
      assignment("u1", "Taras Koval", "c1"),
      // The backfill's secondary users carry their id as the name.
      assignment("u2", "u2", "c1"),
    ];
    renderWithClient(<ContainersPage />);
    const row = screen.getByText("Van Alpha").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Pavlo Bondar, Taras Koval");
    expect(mocks.namesAskedFor.at(-1)).toEqual(["u2"]);
  });

  it("falls back to the van's technician when no assignment points at it", () => {
    mocks.rows = [container({ id: "c2", name: "Van Zeta", technicianId: "t9", technicianName: "Oleh Petrenko" })];
    renderWithClient(<ContainersPage />);
    expect(screen.getByText("Van Zeta").closest("tr")).toHaveTextContent("Oleh Petrenko");
  });
});

const noScroll = { scroll: false };

describe("ContainersPage — popups are driven by the URL", () => {
  it("opens the van's stock from ?stock=<id>", () => {
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    const popup = screen.getByTestId("stock-popup");
    expect(popup).toHaveAttribute("data-type", "container");
    expect(popup).toHaveAttribute("data-id", "c9");
    expect(screen.queryByTestId("edit-popup")).toBeNull();
  });

  it("opens the van's Edit popup from ?edit=<id>", () => {
    mocks.params = new URLSearchParams("edit=c9");
    renderWithClient(<ContainersPage />);
    expect(screen.getByTestId("edit-popup")).toHaveAttribute("data-id", "c9");
    expect(screen.queryByTestId("stock-popup")).toBeNull();
  });

  it("puts the van's template strip over its stock", () => {
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    expect(screen.getByTestId("template-bar")).toHaveAttribute("data-id", "c9");
  });

  it("swaps the stock popup for Apply, naming the van", async () => {
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByText("apply tp1"));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/containers?apply=tp1&container=c9", noScroll);
  });

  it("swaps the stock popup for Edit to set a template", async () => {
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByText("set template"));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/containers?edit=c9", noScroll);
  });

  it("opens Apply from ?apply=<template>&container=<van>", () => {
    mocks.params = new URLSearchParams("apply=tp1&container=c9");
    renderWithClient(<ContainersPage />);
    const popup = screen.getByTestId("apply-popup");
    expect(popup).toHaveAttribute("data-id", "tp1");
    expect(popup).toHaveAttribute("data-container", "c9");
    expect(screen.queryByTestId("stock-popup")).toBeNull();
  });

  it("opens no popup without a param", () => {
    renderWithClient(<ContainersPage />);
    expect(screen.queryByTestId("stock-popup")).toBeNull();
    expect(screen.queryByTestId("edit-popup")).toBeNull();
  });

  it("puts ?stock=<id> in the URL from a row click", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByText("Van Alpha"));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/containers?stock=c1", noScroll);
  });

  it("puts ?edit=<id> in the URL from the row's pencil", async () => {
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Van Zeta" }));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/containers?edit=c2", noScroll);
  });

  it("closing a popup replaces the URL, so Back doesn't reopen it", async () => {
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    await userEvent.click(screen.getByText("close stock"));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/containers", noScroll);
  });

  it("a technician on their own van still gets the read-only view, whatever the URL", () => {
    mocks.scope = DataScope.ASSIGNED_ONLY;
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    expect(screen.getByTestId("my-van")).toBeInTheDocument();
    expect(screen.queryByTestId("stock-popup")).toBeNull();
  });
});

/**
 * "Nothing jumps": on a refresh a dispatcher used to get the technician's
 * "My Container" first — its skeleton, and two requests that 404 for office
 * users — and then the whole page swapped for the fleet.
 */
describe("ContainersPage — a stable first frame", () => {
  it("while permissions load, draws the fleet's frame and asks for nothing", () => {
    mocks.permsLoading = true;
    renderWithClient(<ContainersPage />);

    expect(screen.queryByTestId("my-van")).toBeNull();
    expect(mocks.listFilters).toEqual([]);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toContain("Users");
    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
  });

  // By link the van's stock was asked for only after the permissions and the
  // page: three requests in a row before the popup had anything to show.
  it("asks for a linked van's stock popup while the permissions load", () => {
    mocks.permsLoading = true;
    mocks.params = new URLSearchParams("stock=c9");
    renderWithClient(<ContainersPage />);
    expect(mocks.prefetched).toContain("c9");
  });

  it("prefetches nothing without a linked popup", () => {
    mocks.permsLoading = true;
    renderWithClient(<ContainersPage />);
    expect(mocks.prefetched.filter(Boolean)).toEqual([]);
  });

  it("draws the real table while the first page loads, with the pager's space held", () => {
    mocks.list = { isLoading: true, isPlaceholderData: false, noData: true };
    renderWithClient(<ContainersPage />);

    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the rows on screen, dimmed, while a new search loads", () => {
    mocks.list = { isLoading: false, isPlaceholderData: true, noData: false };
    renderWithClient(<ContainersPage />);

    expect(screen.getByText("Van Alpha")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("has the Department select from the first frame, disabled until the departments arrive", () => {
    mocks.locationsLoading = true;
    renderWithClient(<ContainersPage />);
    expect(screen.getByRole("combobox", { name: "Department" })).toBeDisabled();
  });
});
