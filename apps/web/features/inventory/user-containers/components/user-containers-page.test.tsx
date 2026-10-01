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
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: mocks.locationsLoading ? [] : mocks.locations,
    isLoading: mocks.locationsLoading,
    isError: false,
  }),
}));
// The popup has a suite of its own; here only which user the URL opens matters.
vi.mock("./assign-container-dialog", () => ({
  AssignContainerDialog: (props: { userId: string; user?: { name: string }; open: boolean }) =>
    props.open ? (
      <div data-testid="assign-popup" data-user={props.userId} data-name={props.user?.name ?? ""} />
    ) : null,
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

const TARAS = user("u1", "Taras", "Koval");
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
});

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("UserContainersPage — the users and their vans", () => {
  // A new search holds the area the rows are drawn in, so the pager under it
  // does not jump up into view (see ListBody).
  it("draws its rows in the list's held area, with the pager under it", () => {
    renderWithClient(<UserContainersPage />);
    const area = document.querySelector("[data-slot=list-area]");
    expect(area).toContainElement(screen.getByRole("table"));
    expect(area).not.toContainElement(screen.getByTestId("list-pagination"));
  });

  it("lists the active users, a server page at a time", () => {
    renderWithClient(<UserContainersPage />);
    expect(mocks.userFilters.at(-1)).toEqual({ status: UserStatus.ACTIVE });
    expect(screen.getByText("Taras Koval")).toBeInTheDocument();
    expect(screen.getByText("Olha Melnyk")).toBeInTheDocument();
    // The whole directory is not fetched just to show a page.
    expect(mocks.directoryCalls).toBe(0);
  });

  it("joins each user with their assignment — one row, or Not set", () => {
    renderWithClient(<UserContainersPage />);
    expect(rowOf("Taras Koval")).toHaveTextContent("Van 1");
    expect(rowOf("Taras Koval")).toHaveTextContent("Container");
    expect(rowOf("Olha Melnyk")).toHaveTextContent("Not set");
  });

  it("shows the legacy van of a user without a row", () => {
    mocks.page = [PAVLO];
    renderWithClient(<UserContainersPage />);
    expect(rowOf("Pavlo Bondar")).toHaveTextContent("Van 3legacy");
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
    expect(rowOf("Pavlo Bondar")).toHaveTextContent("Van 3legacy");
  });

  it("says so when nobody matches", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "zzz");
    expect(await screen.findByText("No users match")).toBeInTheDocument();
  });
});

describe("UserContainersPage — the Assign popup", () => {
  const address = () => `${window.location.pathname}${window.location.search}`;
  beforeEach(() => window.history.replaceState(null, "", "/inventory/user-containers"));

  it("opens from a row, handing over the row it has — the address untouched", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.click(screen.getByText("Olha Melnyk"));
    const popup = screen.getByTestId("assign-popup");
    expect(popup).toHaveAttribute("data-user", "u2");
    expect(popup).toHaveAttribute("data-name", "Olha Melnyk");
    expect(address()).toBe("/inventory/user-containers");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("opens nothing from an old ?assign= link, and takes it out of the address", () => {
    window.history.replaceState(null, "", "/inventory/user-containers?assign=u1");
    renderWithClient(<UserContainersPage />);
    expect(screen.queryByTestId("assign-popup")).toBeNull();
    expect(address()).toBe("/inventory/user-containers");
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
 * "Nothing jumps": the table is drawn at its own size while loading, a row
 * never reads "Not set" and then changes its mind, and a search keeps the
 * page on screen while the directory downloads.
 */
describe("UserContainersPage — a stable first frame", () => {
  it("draws the real table while the first page loads, with the pager's space held", () => {
    mocks.usersLoading = true;
    renderWithClient(<UserContainersPage />);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toContain("Container");
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
  });

  it("waits for the assignments before it draws a row — no Not set that turns into a van", () => {
    mocks.assignmentsLoading = true;
    renderWithClient(<UserContainersPage />);
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });

  it("lets a user without a row wait for the fleet, rather than reading Not set first", () => {
    mocks.locationsLoading = true;
    renderWithClient(<UserContainersPage />);
    // Taras has his row: named at once. Olha has none: her van may be a legacy one.
    expect(rowOf("Taras Koval")).toHaveTextContent("Van 1");
    expect(rowOf("Olha Melnyk")).not.toHaveTextContent("Not set");
    expect(rowOf("Olha Melnyk").querySelector("[data-testid=assignment-pending]")).not.toBeNull();
  });

  it("keeps the page on screen, dimmed, while a search downloads the directory", async () => {
    let release: () => void = () => {};
    mocks.directoryGate = new Promise<void>((r) => (release = r));
    renderWithClient(<UserContainersPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "pav");
    await waitFor(() => expect(mocks.directoryCalls).toBe(1));

    expect(screen.getByText("Taras Koval")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton-row")).toBeNull();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");

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
