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
  usePermissions: () => ({ can: mocks.can }),
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

describe("CallGroupsPage", () => {
  beforeEach(() => {
    mocks.groups = [];
    mocks.remove.mockClear();
    mocks.can.mockReturnValue(true);
  });

  it("explains what a group is for when there are none", () => {
    render(<CallGroupsPage />);
    expect(screen.getByText(/no call groups yet/i)).toBeInTheDocument();
    expect(screen.getByText(/rings everyone with the phone switched on/i)).toBeInTheDocument();
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
    expect(screen.getByText("ring all")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText(/1 member · Dana Petrenko/)).toBeInTheDocument();
    expect(screen.getByText("in order")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
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

    await u.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("editor")).toHaveTextContent("editing Dispatch");
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
    expect(screen.queryByRole("button", { name: /new group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("says so plainly when settings are off-limits entirely", () => {
    mocks.can.mockReturnValue(false);
    render(<CallGroupsPage />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
