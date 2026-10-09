import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallGroupWithMembers } from "@bitcrm/types";
import { CallGroupEditor } from "./call-group-editor";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  setMembers: vi.fn(async () => ({})),
}));

vi.mock("../call-groups-hooks", () => ({
  useCreateCallGroup: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCallGroup: () => ({ mutateAsync: mocks.update, isPending: false }),
  useSetCallGroupMembers: () => ({ mutateAsync: mocks.setMembers, isPending: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        id: "u-dana", name: "Dana Petrenko", email: "dana@surelockkey.com",
        phone: "+14045550101", softphoneOnline: true,
      },
      {
        id: "u-tamir", name: "Tamir Levi", email: "tamir@surelockkey.com",
        softphoneOnline: false,
      },
      // The case that made a group quietly never ring: two accounts, one name.
      {
        id: "u-me", name: "Dana Petrenko", email: "dana@gmail.com",
        softphoneOnline: false,
      },
    ],
    isLoading: false,
  }),
}));

const group: CallGroupWithMembers = {
  id: "g1",
  name: "Dispatch",
  type: "ring_all",
  active: true,
  ringSeconds: 25,
  createdBy: "u-admin",
  createdAt: "",
  updatedAt: "",
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
};

/** A teammate's card in Workiz's "Members in group" grid, found by its tick box. */
const card = (name: RegExp) => screen.getByRole("checkbox", { name }).closest("li") as HTMLElement;

/**
 * Workiz's "create group" / "Edit group" modal (pg_settings_phone_wz_groups_create_open,
 * _edit_open): Group name, "Members in group", every teammate as a card in two
 * columns with a tick box. Ours kept in it: how each member is rung, ring
 * order, the description, whether anyone would ring, Active.
 */
describe("CallGroupEditor", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.update.mockClear();
    mocks.setMembers.mockClear();
  });

  it("creates a group with the teammates ticked", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<CallGroupEditor open onClose={onClose} />);

    expect(screen.getByRole("dialog")).toHaveTextContent("Create group");
    expect(screen.getByText("Members in group")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Group name"), "Dispatch");
    await u.click(screen.getByRole("checkbox", { name: /dana@surelockkey/ }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Dispatch",
        type: "ring_all",
        active: true,
        // Softphone by default — a personal leg is billed, so it's a choice.
        members: [{ userId: "u-dana", channel: "softphone", order: 0, enabled: true }],
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("rings in the order the teammates were ticked", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);
    await u.type(screen.getByLabelText("Group name"), "Night");
    await u.click(screen.getByRole("tab", { name: "In order" }));
    await u.click(screen.getByRole("checkbox", { name: /tamir@surelockkey/ }));
    await u.click(screen.getByRole("checkbox", { name: /dana@surelockkey/ }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "in_order",
        members: [
          { userId: "u-tamir", channel: "softphone", order: 0, enabled: true },
          { userId: "u-dana", channel: "softphone", order: 1, enabled: true },
        ],
      }),
    );
  });

  it("will not let somebody be rung on a number they don't have", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("checkbox", { name: /tamir@surelockkey/ }));

    const row = card(/tamir@surelockkey/);
    // Offline softphone and no number of his own — he simply wouldn't ring.
    expect(within(row).getByText(/Won't ring/)).toBeInTheDocument();
    expect(within(row).getByRole("tab", { name: "Personal" })).toBeDisabled();
    expect(within(row).getByRole("tab", { name: "Both" })).toBeDisabled();
    expect(within(row).getByRole("tab", { name: "Softphone" })).toBeEnabled();
  });

  it("offers every teammate once, and keeps a member who is not in the directory", () => {
    render(<CallGroupEditor group={group} open onClose={vi.fn()} />);
    expect(screen.getAllByRole("checkbox", { name: /dana@surelockkey/ })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Marco Ruiz/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /tamir@surelockkey/ })).not.toBeChecked();
  });

  it("saves an edit as fields first, then the whole membership", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor group={group} open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toHaveTextContent("Edit group");
    await u.click(within(card(/Marco Ruiz/)).getByRole("tab", { name: "Personal" }));
    await u.click(screen.getByRole("tab", { name: "In order" }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Dispatch", type: "in_order" }));
    expect(mocks.setMembers).toHaveBeenCalledWith([{ userId: "u-marco", channel: "personal", order: 0, enabled: true }]);
  });

  it("unticks a member in the draft without touching the server until save", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor group={group} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("checkbox", { name: /Marco Ruiz/ }));
    expect(screen.getByRole("checkbox", { name: /Marco Ruiz/ })).not.toBeChecked();
    expect(mocks.setMembers).not.toHaveBeenCalled();

    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.setMembers).toHaveBeenCalledWith([]);
  });

  it("refuses to save a group with no name", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await u.type(screen.getByLabelText("Group name"), "D");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  describe("telling two accounts with one name apart", () => {
    it("shows each person's email on their card", () => {
      render(<CallGroupEditor open onClose={vi.fn()} />);
      // Two "Dana Petrenko" — only the email says which is which.
      expect(screen.getByText(/dana@surelockkey\.com/)).toBeInTheDocument();
      expect(screen.getByText(/dana@gmail\.com/)).toBeInTheDocument();
    });

    it("finds somebody by email as well as by name", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);

      await u.type(screen.getByRole("searchbox", { name: "Search teammates" }), "gmail");

      expect(screen.getByText(/dana@gmail\.com/)).toBeInTheDocument();
      expect(screen.queryByText(/dana@surelockkey\.com/)).not.toBeInTheDocument();
    });
  });

  describe("whether the group can actually be reached", () => {
    it("counts who would ring right now", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);
      await u.click(screen.getByRole("checkbox", { name: /dana@surelockkey/ }));
      expect(screen.getByText("1 of 1 reachable right now.")).toBeInTheDocument();
    });

    it("warns plainly when a call to this group would go unanswered", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);
      // Offline softphone, no number of his own.
      await u.click(screen.getByRole("checkbox", { name: /tamir@surelockkey/ }));
      expect(screen.getByText(/would go unanswered/i)).toBeInTheDocument();
    });
  });
});
