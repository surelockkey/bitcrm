import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TechniciansPage } from "./technicians-page";

/**
 * The list as Workiz's Team page works it: opening on "status: Active",
 * searching, the columns of Filter results, "+ Add New" for whoever may add
 * people, and our review queue beside it.
 */

const state = vi.hoisted(() => ({ canAddUsers: true, canApprove: true, canViewTechs: true }));
const fx = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fx.push }) }));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    isLoading: false,
    can: (resource: string, action = "view") => {
      if (resource === "technicians") return state.canViewTechs;
      if (resource === "users" && action === "create") return state.canAddUsers;
      if (resource === "job_types" && action === "approve") return state.canApprove;
      return true;
    },
  }),
}));

const page = (data: unknown[]) => ({ data, pagination: {} });
const profile = (userId: string, status: string, technicianType = "regular") => ({
  userId,
  status,
  technicianType,
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const person = (id: string, firstName: string, lastName: string, roleId = "role-tech") => ({
  id,
  firstName,
  lastName,
  email: `${firstName.toLowerCase()}@slk.com`,
  roleId,
  createdAt: "2026-01-01T00:00:00Z",
});

vi.mock("../hooks", () => ({
  useTechnicians: () => ({
    data: {
      pages: [
        page([
          profile("u-a", "active"),
          profile("u-p", "pending", "subcontractor"),
          profile("u-i", "inactive"),
        ]),
      ],
    },
    isError: false,
    isPending: false,
    fetchStatus: "idle",
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useUserMap: () => ({
    data: new Map([
      ["u-a", person("u-a", "Alma", "Active")],
      ["u-p", person("u-p", "Pete", "Pending", "role-dispatch")],
      ["u-i", person("u-i", "Ivy", "Inactive")],
    ]),
    isError: false,
    isPending: false,
    fetchStatus: "idle",
  }),
  useApprovedAssignments: () => ({
    data: { jobTypes: [], serviceAreas: [{ userId: "u-p", serviceAreaId: "sa-ny", status: "approved" }] },
    isError: false,
    isPending: false,
    fetchStatus: "idle",
  }),
  usePendingAssignments: (enabled: boolean) => ({
    data: enabled ? { jobTypes: [{ userId: "u-p", jobTypeId: "jt-1", status: "pending" }], serviceAreas: [] } : undefined,
    isError: false,
    isPending: !enabled,
    fetchStatus: "idle",
  }),
}));

vi.mock("@/features/roles/hooks", () => ({
  useRoles: () => ({
    data: [
      { id: "role-tech", name: "tech" },
      { id: "role-dispatch", name: "dispatch" },
    ],
    isError: false,
    isPending: false,
    fetchStatus: "idle",
  }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "sa-ny", name: "SURE LOCK NY" }], isError: false, isPending: false, fetchStatus: "idle" }),
}));
vi.mock("@/features/job-types/lib", () => ({ useJobTypesLoading: () => false, useJobTypeName: () => (id: string) => id }));
vi.mock("@/features/users/components/create-user-sheet", () => ({
  CreateUserSheet: () => <div role="dialog" aria-label="Add user" />,
}));
vi.mock("./assignments-queue-dialog", () => ({
  AssignmentsQueueDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Review queue" /> : null),
}));

beforeEach(() => {
  state.canAddUsers = true;
  state.canApprove = true;
  state.canViewTechs = true;
  fx.push.mockReset();
  localStorage.clear();
});

const names = () =>
  [...document.querySelectorAll("tbody tr:not([aria-hidden])")].map((r) => r.querySelector("td span")?.textContent);

describe("TechniciansPage — Workiz's Team", () => {
  // app_audit_wz_team: the band says "Team — Manage and add users to your team".
  it("wears Workiz's Team band", () => {
    render(<TechniciansPage />);
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Manage and add users to your team")).toBeInTheDocument();
  });

  it("opens on 'status: Active', which keeps a technician still awaiting setup", () => {
    render(<TechniciansPage />);
    expect(screen.getByText("status: Active")).toBeInTheDocument();
    expect(names()).toEqual(["Alma Active", "Pete Pending"]);
    expect(screen.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
  });

  it("shows everyone once the chip is taken off", async () => {
    render(<TechniciansPage />);
    await userEvent.click(screen.getByRole("button", { name: "Remove status: Active" }));
    expect(names()).toEqual(["Alma Active", "Ivy Inactive", "Pete Pending"]);
  });

  it("filters by the columns Workiz offers: role, user type, service area", async () => {
    render(<TechniciansPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    const menu = screen.getByRole("listbox", { name: "Service area" });
    await userEvent.click(within(menu).getByRole("option", { name: "SURE LOCK NY" }));
    expect(names()).toEqual(["Pete Pending"]);
  });

  it("searches names and emails", async () => {
    render(<TechniciansPage />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "alma@");
    expect(names()).toEqual(["Alma Active"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "nobody");
    expect(names()).toEqual([]);
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("opens the technician from the row", async () => {
    render(<TechniciansPage />);
    await userEvent.click(screen.getByText("Alma Active"));
    expect(fx.push).toHaveBeenCalledWith("/technicians/u-a");
  });

  it("'+ Add New' opens the add-user sheet, for whoever may add people", async () => {
    const { unmount } = render(<TechniciansPage />);
    expect(screen.queryByRole("dialog", { name: "Add user" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByRole("dialog", { name: "Add user" })).toBeInTheDocument();
    unmount();

    state.canAddUsers = false;
    render(<TechniciansPage />);
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
  });

  it("keeps our review queue beside it, for a manager with something to review", async () => {
    const { unmount } = render(<TechniciansPage />);
    await userEvent.click(screen.getByRole("button", { name: "1 assignment awaiting review" }));
    expect(screen.getByRole("dialog", { name: "Review queue" })).toBeInTheDocument();
    unmount();

    state.canApprove = false;
    render(<TechniciansPage />);
    expect(screen.queryByRole("button", { name: /awaiting review/ })).toBeNull();
  });

  it("refuses the page without technicians.view", () => {
    state.canViewTechs = false;
    render(<TechniciansPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });
});
