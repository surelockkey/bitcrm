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
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn() }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/inventory/user-containers",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("@/features/users/hooks", () => ({
  useUsers: (filter: unknown) => {
    mocks.userFilters.push(filter);
    return {
      data: { pages: [{ data: mocks.page, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
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
    return mocks.directory;
  },
}));
vi.mock("../hooks", () => ({
  useUserContainers: () => ({ data: mocks.rows, isLoading: false, isError: false }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: mocks.locations, isLoading: false, isError: false }),
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
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
});

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("UserContainersPage — the users and their vans", () => {
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
  it("opens from a row, in the URL", async () => {
    renderWithClient(<UserContainersPage />);
    await userEvent.click(screen.getByText("Olha Melnyk"));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/user-containers?assign=u2", { scroll: false });
  });

  it("opens for the user the URL names, handing over the row it has", () => {
    mocks.params = new URLSearchParams("assign=u1");
    renderWithClient(<UserContainersPage />);
    const popup = screen.getByTestId("assign-popup");
    expect(popup).toHaveAttribute("data-user", "u1");
    expect(popup).toHaveAttribute("data-name", "Taras Koval");
  });

  it("opens for a user who isn't on this page — the popup looks them up", () => {
    mocks.params = new URLSearchParams("assign=u9");
    renderWithClient(<UserContainersPage />);
    expect(screen.getByTestId("assign-popup")).toHaveAttribute("data-name", "");
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
