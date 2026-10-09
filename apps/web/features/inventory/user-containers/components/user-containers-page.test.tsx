import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, UserContainerAccess, UserStatus } from "@bitcrm/types";
import type { User, UserContainer } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  page: [] as User[],
  directory: [] as User[],
  directoryCalls: 0,
  userFilters: [] as unknown[],
  rows: [] as UserContainer[],
  locations: [] as StockLocation[],
  push: vi.fn(),
  replace: vi.fn(),
  permsLoading: false,
  usersLoading: false,
  assignmentsLoading: false,
  locationsLoading: false,
  /** The directory a search reads: held back until a test releases it. */
  directoryGate: null as Promise<void> | null,
  usersOptions: [] as unknown[],
  assign: vi.fn(),
  roles: [] as { id: string; name: string }[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn() }),
  usePathname: () => "/inventory/user-containers",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") =>
    !mocks.permsLoading && mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") =>
      !mocks.permsLoading && !mocks.denied.has(`${resource}.${action}`),
    isLoading: mocks.permsLoading,
  }),
}));
vi.mock("@/features/users/hooks", () => ({
  useUsers: (filter: unknown, _limit: number, options?: unknown) => {
    mocks.userFilters.push(filter);
    mocks.usersOptions.push(options);
    return {
      data: mocks.usersLoading ? undefined : { pages: [{ data: mocks.page, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: mocks.usersLoading,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useUsersCount: () => ({ data: { total: mocks.page.length, atLeast: false } }),
}));
vi.mock("@/features/technicians/api", () => ({
  fetchAllUsers: async () => {
    mocks.directoryCalls += 1;
    if (mocks.directoryGate) await mocks.directoryGate;
    return mocks.directory;
  },
}));
vi.mock("../hooks", () => ({
  useUserContainers: () => ({
    data: mocks.assignmentsLoading ? undefined : mocks.rows,
    isLoading: mocks.assignmentsLoading,
    isError: false,
  }),
  useAssignUserContainer: () => ({ isPending: false, mutate: mocks.assign }),
}));
vi.mock("@/features/roles/hooks", () => ({
  useRoles: (enabled: boolean) => ({
    data: enabled ? mocks.roles : undefined,
    isError: false,
    isPending: !enabled,
    fetchStatus: "idle",
  }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: mocks.locationsLoading ? [] : mocks.locations,
    isLoading: mocks.locationsLoading,
    isError: false,
  }),
}));

import { UserContainersPage } from "./user-containers-page";

const user = (id: string, firstName: string, lastName: string, over: Partial<User> = {}): User =>
  ({
    id,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@x.com`,
    status: UserStatus.ACTIVE,
    ...over,
  }) as User;

const TARAS = user("u1", "Taras", "Koval", { roleId: "role-tech" });
const OLHA = user("u2", "Olha", "Melnyk");
const PAVLO = user("u3", "Pavlo", "Bondar");
const GONE = user("u4", "Pavla", "Former", { status: UserStatus.INACTIVE });

beforeEach(() => {
  mocks.denied = new Set();
  mocks.page = [TARAS, OLHA];
  mocks.directory = [TARAS, OLHA, PAVLO, GONE];
  mocks.directoryCalls = 0;
  mocks.userFilters = [];
  mocks.rows = [
    {
      userId: "u1",
      userName: "Taras Koval",
      access: UserContainerAccess.CONTAINER,
      containerId: "c1",
      containerName: "Van 1",
      limited: false,
      updatedAt: "2026-09-28T10:00:00.000Z",
    },
  ];
  mocks.locations = [
    { type: "container", id: "c1", name: "Van 1", status: InventoryStatus.ACTIVE },
    { type: "container", id: "c3", name: "Van 3", status: InventoryStatus.ACTIVE, technicianId: "u3" },
  ];
  mocks.push.mockReset();
  mocks.permsLoading = false;
  mocks.usersLoading = false;
  mocks.assignmentsLoading = false;
  mocks.locationsLoading = false;
  mocks.directoryGate = null;
  mocks.usersOptions = [];
  mocks.assign.mockReset();
  mocks.roles = [{ id: "role-tech", name: "technician" }];
});

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;


/** A row's Location box and Restricted switch, by the user's name. */
const box = (name: string) => screen.getByRole("combobox", { name: `Location — ${name}` });
const restricted = (name: string) => screen.getByRole("switch", { name: `Restricted — ${name}` });

/**
 * Workiz's "User locations" (pg_inventory_wz_02_user-locations): Name, Role,
 * the Location box and the Restricted switch — both saving at once.
 */
describe("UserContainersPage — the users and their vans", () => {
  // Workiz's grid is never shorter than ten rows and holds its pager.
  it("draws its rows in Workiz's grid, the pager inside it under them", () => {
    renderWithClient(<UserContainersPage />);
    const grid = document.querySelector("[data-slot=wz-report-grid]");
    expect(grid).toContainElement(screen.getByRole("table"));
    expect(grid).toContainElement(screen.getByTestId("list-pagination"));
  });

  it("has Workiz's columns, BitCRM's Updated at the end", () => {
    renderWithClient(<UserContainersPage />);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Name",
      "Role",
      "Location",
      "Restricted",
      "Updated",
    ]);
  });

  it("lists the active users, a server page at a time, with their role", () => {
    renderWithClient(<UserContainersPage />);
    expect(mocks.userFilters.at(-1)).toEqual({ status: UserStatus.ACTIVE });
    expect(rowOf("Taras Koval")).toHaveTextContent("technician");
    expect(screen.getByText("Olha Melnyk")).toBeInTheDocument();
    // The whole directory is not fetched just to show a page.
    expect(mocks.directoryCalls).toBe(0);
  });

  it("puts each user's assignment in the Location box — a van, or Not set", () => {
    renderWithClient(<UserContainersPage />);
    expect(box("Taras Koval")).toHaveTextContent("Van 1");
    expect(box("Olha Melnyk")).toHaveTextContent("Not set");
  });

  it("shows the legacy van of a user without a row", () => {
    mocks.page = [PAVLO];
    renderWithClient(<UserContainersPage />);
    expect(box("Pavlo Bondar")).toHaveTextContent("Van 3 (legacy)");
  });

  it("saves a pick in the Location box at once — All, No access or a van", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.click(box("Olha Melnyk"));
    await userEvent.click(await screen.findByRole("option", { name: "Van 3" }));
    expect(mocks.assign).toHaveBeenCalledWith(
      { userId: "u2", body: { userName: "Olha Melnyk", access: UserContainerAccess.CONTAINER, containerId: "c3", limited: false } },
      expect.anything(),
    );

    await userEvent.click(box("Taras Koval"));
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    expect(mocks.assign).toHaveBeenLastCalledWith(
      { userId: "u1", body: { userName: "Taras Koval", access: UserContainerAccess.ALL } },
      expect.anything(),
    );
  });

  it("restricts a user to their van with the switch, and has no switch to flip without one", async () => {
    renderWithClient(<UserContainersPage />);
    expect(restricted("Olha Melnyk")).toBeDisabled();
    await userEvent.click(restricted("Taras Koval"));
    expect(mocks.assign).toHaveBeenCalledWith(
      { userId: "u1", body: { userName: "Taras Koval", access: UserContainerAccess.CONTAINER, containerId: "c1", limited: true } },
      expect.anything(),
    );
  });

  it("is read-only without containers.edit", () => {
    mocks.denied.add("containers.edit");
    renderWithClient(<UserContainersPage />);
    expect(box("Taras Koval")).toBeDisabled();
    expect(restricted("Taras Koval")).toBeDisabled();
  });

  // The users service can't search, and filtering the one page on screen
  // would miss everyone on the others: search runs over the whole directory.
  it("searches every active user, not just the page on screen", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "pav");
    await waitFor(() => expect(screen.getByText("Pavlo Bondar")).toBeInTheDocument());
    expect(screen.queryByText("Taras Koval")).toBeNull();
    // Inactive users stay out, search or not.
    expect(screen.queryByText("Pavla Former")).toBeNull();
    expect(box("Pavlo Bondar")).toHaveTextContent("Van 3 (legacy)");
  });

  it("leaves the blank rows when nobody matches, as Workiz does", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "zzz");
    expect(await screen.findByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("takes an old ?assign= link's param out of the address", () => {
    window.history.replaceState(null, "", "/inventory/user-containers?assign=u1");
    renderWithClient(<UserContainersPage />);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/inventory/user-containers");
  });
});

describe("UserContainersPage — access", () => {
  it("is closed without containers.view", () => {
    mocks.denied.add("containers.view");
    renderWithClient(<UserContainersPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains that the list needs users.view", () => {
    mocks.denied.add("users.view");
    renderWithClient(<UserContainersPage />);
    expect(screen.getByText(/permission to view users/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

/**
 * "Nothing jumps": one loader, a row never reads "Not set" and then changes
 * its mind, and a search keeps the page on screen while the directory downloads.
 */
describe("UserContainersPage — a stable first frame", () => {
  it("draws the grid's header over Workiz's loader while the first page loads, no pager", () => {
    mocks.usersLoading = true;
    renderWithClient(<UserContainersPage />);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toContain("Location");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByTestId("list-pagination")).toBeNull();
  });

  it("waits for the assignments before it draws a row — no Not set that turns into a van", () => {
    mocks.assignmentsLoading = true;
    renderWithClient(<UserContainersPage />);
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  // A user without a row of their own may work from a legacy van the fleet
  // names: the grid waits for the fleet rather than changing that row later.
  it("waits for the fleet before it draws a row", () => {
    mocks.locationsLoading = true;
    renderWithClient(<UserContainersPage />);
    expect(screen.queryByText("Olha Melnyk")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("keeps the page on screen, dimmed, while a search downloads the directory", async () => {
    let release: () => void = () => {};
    mocks.directoryGate = new Promise<void>((r) => (release = r));
    renderWithClient(<UserContainersPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "pav");
    await waitFor(() => expect(mocks.directoryCalls).toBe(1));

    expect(screen.getByText("Taras Koval")).toBeInTheDocument();
    expect(document.querySelector("[data-slot=wz-report-grid]")).toHaveAttribute("aria-busy", "true");

    release();
    await waitFor(() => expect(screen.getByText("Pavlo Bondar")).toBeInTheDocument());
  });

  it("asks the users list to keep its page while the next size loads", () => {
    renderWithClient(<UserContainersPage />);
    expect(mocks.usersOptions.at(-1)).toMatchObject({ keepPrevious: true });
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.permsLoading = true;
    renderWithClient(<UserContainersPage />);
    expect(screen.queryByText("No access")).toBeNull();
  });
});
