import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallGroupWithMembers } from "@bitcrm/types";
import { CallGroupsPage } from "./call-groups-page";

const mocks = vi.hoisted(() => ({
  groups: [] as CallGroupWithMembers[],
  remove: vi.fn(),
  can: vi.fn((_resource: string, _action?: string) => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  // The permissions are in: refused exactly where `can` says no.
  useDenied: () => (resource: string, action?: string) => !mocks.can(resource, action),
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({ data: mocks.groups, isLoading: false }),
  useDeleteCallGroup: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock("./call-group-editor", () => ({
  CallGroupEditor: ({ group }: { group?: CallGroupWithMembers }) => (
    <div data-testid="editor">{group ? `editing ${group.name}` : "creating"}</div>
  ),
}));

const group = (over: Partial<CallGroupWithMembers> = {}): CallGroupWithMembers => ({
  id: "g1",
  name: "Dispatch",
  type: "ring_all",
  active: true,
  ringSeconds: 25,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  members: [
    {
      userId: "u-dana",
      channel: "softphone",
      order: 0,
      enabled: true,
      name: "Dana Petrenko",
      softphoneOnline: true,
      missing: false,
    },
  ],
  ...over,
});

/**
 * Workiz Phone → Call groups (pg_settings_phone_wz_groups): its words and
 * "Create a group", the strip, and the grid Name | Users and devices |
 * Actions (pencil, bin); ours keep the ring type and the paused state as
 * tags beside the name.
 */
describe("CallGroupsPage", () => {
  beforeEach(() => {
    mocks.groups = [];
    mocks.remove.mockClear();
    mocks.can.mockReturnValue(true);
  });

  it("draws Workiz's words, Create a group and its columns", () => {
    mocks.groups = [group()];
    render(<CallGroupsPage />);
    expect(screen.getByText(/Call groups are a great way to forward calls/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a group" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Users and devices", "Actions"]);
  });

  it("says Workiz's words over an empty grid", () => {
    render(<CallGroupsPage />);
    expect(screen.getByText("No call groups created")).toBeInTheDocument();
    expect(screen.getByText(/Forward calls to multiple users or devices by creating your first group/)).toBeInTheDocument();
  });

  it("lists a group with its type, state and members", () => {
    mocks.groups = [
      group(),
      group({
        id: "g2",
        name: "After hours",
        type: "in_order",
        active: false,
        members: [
          {
            userId: "u-marco",
            channel: "both",
            order: 0,
            enabled: true,
            name: "Marco Ruiz",
            phone: "+14045550134",
            softphoneOnline: false,
            missing: false,
          },
        ],
      }),
    ];
    render(<CallGroupsPage />);

    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByText("Dana Petrenko (Softphone)")).toBeInTheDocument();
    expect(screen.getByText("Marco Ruiz (Softphone, (404) 555-0134)")).toBeInTheDocument();
    // Ring all is Workiz's only kind, so only ours are tagged.
    expect(screen.getAllByText("In order")).toHaveLength(1);
    expect(screen.getAllByText("Paused")).toHaveLength(1);
  });

  it("lists a group's devices after its people, as Workiz's Users and devices column does", () => {
    mocks.groups = [
      group({
        deviceMembers: [
          { deviceId: "d-ct", order: 0, enabled: true, name: "SURE CT LOCKSMITH", number: "+12039893585", missing: false },
        ],
      }),
      // A group of devices only still has somebody to ring.
      group({
        id: "g2",
        name: "SURE FL LOCKSMITH",
        members: [],
        deviceMembers: [
          { deviceId: "d-fl", order: 0, enabled: true, name: "SURE FL LOCKSMITH", number: "+15613030120", missing: false },
        ],
      }),
    ];
    render(<CallGroupsPage />);
    expect(screen.getByText("Dana Petrenko (Softphone), SURE CT LOCKSMITH ((203) 989-3585)")).toBeInTheDocument();
    expect(screen.getByText("SURE FL LOCKSMITH ((561) 303-0120)")).toBeInTheDocument();
    expect(screen.queryByText("No members yet")).not.toBeInTheDocument();
  });

  it("names a member who has left rather than showing a bare id", () => {
    mocks.groups = [
      group({
        members: [
          {
            userId: "u-gone",
            channel: "softphone",
            order: 0,
            enabled: true,
            softphoneOnline: false,
            missing: true,
          },
        ],
      }),
    ];
    render(<CallGroupsPage />);

    expect(screen.getByText(/Former teammate/)).toBeInTheDocument();
    expect(screen.queryByText(/u-gone/)).not.toBeInTheDocument();
  });

  it("opens the editor for a group, and for a new one", async () => {
    const u = userEvent.setup();
    mocks.groups = [group()];
    render(<CallGroupsPage />);

    await u.click(screen.getByRole("button", { name: "Edit Dispatch" }));
    expect(screen.getByTestId("editor")).toHaveTextContent("editing Dispatch");
  });

  it("opens the editor for a new group from Create a group", async () => {
    const u = userEvent.setup();
    render(<CallGroupsPage />);
    await u.click(screen.getByRole("button", { name: "Create a group" }));
    expect(screen.getByTestId("editor")).toHaveTextContent("creating");
  });

  it("confirms before deleting, and says what is not touched", async () => {
    const u = userEvent.setup();
    mocks.groups = [group()];
    render(<CallGroupsPage />);

    await u.click(screen.getByRole("button", { name: /delete dispatch/i }));
    expect(screen.getByText(/Nobody's account or phone number is touched/)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("g1");
  });

  it("hides every control from someone who can only view settings", () => {
    mocks.can.mockImplementation((_r: string, action?: string) => action !== "edit");
    mocks.groups = [group()];
    render(<CallGroupsPage />);

    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create a group" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Dispatch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete dispatch/i })).not.toBeInTheDocument();
  });

  it("says so plainly when settings are off-limits entirely", () => {
    mocks.can.mockReturnValue(false);
    render(<CallGroupsPage />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
