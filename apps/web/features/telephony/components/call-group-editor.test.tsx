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

const memberRow = (name: string) =>
  screen.getByText(name).closest("li") as HTMLElement;

describe("CallGroupEditor", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.update.mockClear();
    mocks.setMembers.mockClear();
  });

  it("creates a group with the members that were added", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<CallGroupEditor open onClose={onClose} />);

    await u.type(screen.getByLabelText("Name"), "Dispatch");
    await u.click(screen.getByRole("button", { name: /add member/i }));
    await u.click(screen.getByRole("button", { name: /dana@surelockkey/ }));
    await u.click(screen.getByRole("button", { name: /create group/i }));

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

  it("will not let somebody be rung on a number they don't have", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /add member/i }));
    await u.click(screen.getByRole("button", { name: /tamir@surelockkey/ }));

    const row = memberRow("Tamir Levi");
    // Offline softphone and no number of his own — he simply wouldn't ring.
    expect(within(row).getByText(/Won't ring/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Personal" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Both" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Softphone" })).toBeEnabled();
  });

  it("keeps the same person from being added twice", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /add member/i }));
    await u.click(screen.getByRole("button", { name: /dana@surelockkey/ }));
    await u.click(screen.getByRole("button", { name: /add member/i }));

    // The picker no longer offers that account — though the other Dana, a
    // different person entirely, is still there.
    expect(
      screen.queryByRole("button", { name: /dana@surelockkey/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dana@gmail/ })).toBeInTheDocument();
  });

  it("saves an edit as fields first, then the whole membership", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor group={group} open onClose={vi.fn()} />);

    await u.click(within(memberRow("Marco Ruiz")).getByRole("button", { name: "Personal" }));
    await u.click(screen.getByRole("button", { name: /in order/i }));
    await u.click(screen.getByRole("button", { name: /save group/i }));

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Dispatch", type: "in_order" }),
    );
    expect(mocks.setMembers).toHaveBeenCalledWith([
      { userId: "u-marco", channel: "personal", order: 0, enabled: true },
    ]);
  });

  it("removes a member from the draft without touching the server until save", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor group={group} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /remove marco ruiz/i }));
    expect(screen.queryByText("Marco Ruiz")).not.toBeInTheDocument();
    expect(mocks.setMembers).not.toHaveBeenCalled();

    await u.click(screen.getByRole("button", { name: /save group/i }));
    expect(mocks.setMembers).toHaveBeenCalledWith([]);
  });

  it("refuses to save a group with no name", async () => {
    const u = userEvent.setup();
    render(<CallGroupEditor open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /create group/i })).toBeDisabled();
    await u.type(screen.getByLabelText("Name"), "D");
    expect(screen.getByRole("button", { name: /create group/i })).toBeEnabled();
  });

  describe("telling two accounts with one name apart", () => {
    it("shows each person's email in the picker", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);

      await u.click(screen.getByRole("button", { name: /add member/i }));

      // Two "Dana Petrenko" — only the email says which is which.
      expect(screen.getByText(/dana@surelockkey\.com/)).toBeInTheDocument();
      expect(screen.getByText(/dana@gmail\.com/)).toBeInTheDocument();
    });

    it("finds somebody by email as well as by name", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);

      await u.click(screen.getByRole("button", { name: /add member/i }));
      await u.type(screen.getByPlaceholderText(/search teammates/i), "gmail");

      expect(screen.getByText(/dana@gmail\.com/)).toBeInTheDocument();
      expect(screen.queryByText(/dana@surelockkey\.com/)).not.toBeInTheDocument();
    });
  });

  describe("whether the group can actually be reached", () => {
    it("counts who would ring right now", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);

      await u.click(screen.getByRole("button", { name: /add member/i }));
      await u.click(screen.getByRole("button", { name: /dana@surelockkey/ }));

      expect(screen.getByText("1 of 1 reachable right now.")).toBeInTheDocument();
    });

    it("warns plainly when a call to this group would go unanswered", async () => {
      const u = userEvent.setup();
      render(<CallGroupEditor open onClose={vi.fn()} />);

      await u.click(screen.getByRole("button", { name: /add member/i }));
      // Offline softphone, no number of his own.
      await u.click(screen.getByRole("button", { name: /tamir@surelockkey/ }));

      expect(
        screen.getByText(/would go unanswered/i),
      ).toBeInTheDocument();
    });
  });
});
