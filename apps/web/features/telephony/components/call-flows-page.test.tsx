import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow } from "@bitcrm/types";
import { CallFlowsPage } from "./call-flows-page";

const mocks = vi.hoisted(() => ({
  flows: [] as CallFlow[],
  remove: vi.fn(),
  duplicate: vi.fn(),
  can: vi.fn((_resource: string, _action?: string) => true),
  config: { technicianLine: null, fallbackNumber: null } as { technicianLine: string | null; fallbackNumber?: string | null },
  setFallback: vi.fn(async (_n: string | null) => ({})),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../call-flows-hooks", () => ({
  useCallFlows: () => ({ data: mocks.flows, isLoading: false }),
  useDeleteCallFlow: () => ({ mutate: mocks.remove, isPending: false }),
  useDuplicateCallFlow: () => ({ mutate: mocks.duplicate, isPending: false }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({ data: [{ id: "g1", name: "Dispatch", members: [] }] }),
  useTeammates: () => ({ data: [{ id: "u-riley", name: "Riley CSR", softphoneOnline: true }] }),
}));
vi.mock("../call-devices-hooks", () => ({
  useCallDevices: () => ({ data: [{ id: "d-ct", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true }] }),
}));
vi.mock("../config-hooks", () => ({
  useTelephonyConfig: () => ({ data: mocks.config }),
  useSetFallbackNumber: () => ({ mutateAsync: mocks.setFallback, isPending: false }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const flow = (over: Partial<CallFlow> = {}): CallFlow => ({
  id: "f1",
  name: "Main line",
  numbers: ["+15412830739"],
  entryNodeId: "greeting",
  nodes: {
    greeting: { id: "greeting", type: "say", text: "Thanks for calling.", next: "ring" },
    ring: { id: "ring", type: "ring", groupId: "g1", next: "end" },
    end: { id: "end", type: "voicemail", prompt: "Leave a message.", maxSeconds: 120 },
  },
  active: true,
  version: 1,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

/**
 * Workiz Phone → Call flows (pg_settings_phone_wz_flows): its words and
 * "+ Create Call Flow", the strip, the grid Name | Numbers | Actions (edit
 * opens the builder, bin, copy). Ours: the Steps column (what the flow does,
 * in order) and a Paused tag.
 */
describe("CallFlowsPage", () => {
  beforeEach(() => {
    mocks.flows = [];
    mocks.remove.mockClear();
    mocks.duplicate.mockClear();
    mocks.can.mockReturnValue(true);
    mocks.config = { technicianLine: null, fallbackNumber: null };
    mocks.setFallback.mockClear();
  });

  it("draws Workiz's words, Create Call Flow and the columns", () => {
    mocks.flows = [flow()];
    const { container } = render(<CallFlowsPage />);
    expect(screen.getByText(/Call flows route your calls to where they need to go/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Call Flow" })).toHaveAttribute("href", "/calls/flows/new");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Numbers", "Steps", "Actions"]);
    // Workiz's "Use smart callback" row stands between the words and the
    // strip (pg_settings_phone_wz_flows: strip at y347, ours sat at y318 —
    // app_audit #23). We have no such feature, so its 29px stay and the
    // checkbox does not: no dead control.
    const space = container.querySelector('[data-slot="smart-callback-space"]');
    expect(space).not.toBeNull();
    expect(space?.className).toContain("h-[29px]");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("summarises what a flow actually does, in order, beside its numbers", () => {
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    expect(screen.getByText("Main line")).toBeInTheDocument();
    expect(screen.getByText("greeting → ring Dispatch → voicemail")).toBeInTheDocument();
    expect(screen.getByText("(541) 283-0739")).toBeInTheDocument();
  });

  it("names whoever a Forward step rings: a teammate, a device, an outside number", () => {
    mocks.flows = [
      flow({
        entryNodeId: "u",
        nodes: {
          u: { id: "u", type: "ring", target: { kind: "user", id: "u-riley" }, next: "d" },
          d: { id: "d", type: "ring", target: { kind: "device", id: "d-ct" }, next: "x" },
          x: { id: "x", type: "ring", target: { kind: "external", number: "+18888996849" } },
        },
      }),
    ];
    render(<CallFlowsPage />);
    expect(screen.getByText("ring Riley CSR → ring SURE CT LOCKSMITH → ring (888) 899-6849")).toBeInTheDocument();
  });

  describe("Workiz's Fallback Number row", () => {
    const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

    it("is the grid's first row, with Add when none is set", () => {
      mocks.flows = [flow()];
      render(<CallFlowsPage />);
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent("Fallback Number");
      expect(within(rowOf("Fallback Number")).getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("sets the number from Add", async () => {
      const u = userEvent.setup();
      render(<CallFlowsPage />);
      await u.click(within(rowOf("Fallback Number")).getByRole("button", { name: "Add" }));
      const dialog = screen.getByRole("dialog", { name: "Fallback Number" });
      expect(dialog).toHaveTextContent(/nobody answers/i);
      await u.type(within(dialog).getByLabelText("Phone number"), "8557951267");
      await u.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(mocks.setFallback).toHaveBeenCalledWith("+18557951267");
    });

    it("won't save a number that is not one", async () => {
      const u = userEvent.setup();
      render(<CallFlowsPage />);
      await u.click(within(rowOf("Fallback Number")).getByRole("button", { name: "Add" }));
      const dialog = screen.getByRole("dialog", { name: "Fallback Number" });
      await u.type(within(dialog).getByLabelText("Phone number"), "12");
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("shows the number once set, to change or remove", async () => {
      const u = userEvent.setup();
      mocks.config = { technicianLine: null, fallbackNumber: "+18557951267" };
      render(<CallFlowsPage />);
      const row = rowOf("Fallback Number");
      expect(row).toHaveTextContent("(855) 795-1267");
      expect(within(row).queryByRole("button", { name: "Add" })).not.toBeInTheDocument();

      await u.click(within(row).getByRole("button", { name: "Edit Fallback Number" }));
      expect(screen.getByLabelText("Phone number")).toHaveValue("(855) 795-1267");
      await u.keyboard("{Escape}");

      await u.click(within(row).getByRole("button", { name: "Remove Fallback Number" }));
      await u.click(screen.getByRole("button", { name: "Remove" }));
      expect(mocks.setFallback).toHaveBeenCalledWith(null);
    });

    it("is shown, but not changeable, to someone who can only view settings", () => {
      mocks.can.mockImplementation((_r: string, action?: string) => action !== "edit");
      mocks.config = { technicianLine: null, fallbackNumber: "+18557951267" };
      render(<CallFlowsPage />);
      const row = rowOf("Fallback Number");
      expect(row).toHaveTextContent("(855) 795-1267");
      expect(within(row).queryAllByRole("button")).toHaveLength(0);
    });

    it("stays on an API from before it (no fallbackNumber at all), offering Add", () => {
      mocks.config = { technicianLine: null };
      render(<CallFlowsPage />);
      expect(within(rowOf("Fallback Number")).getByRole("button", { name: "Add" })).toBeInTheDocument();
    });
  });

  it("says a flow answers nothing when it has no numbers", () => {
    mocks.flows = [flow({ numbers: [] })];
    render(<CallFlowsPage />);
    expect(screen.getByText(/answers nothing yet/i)).toBeInTheDocument();
  });

  it("names a group that has been deleted rather than showing a bare id", () => {
    mocks.flows = [
      flow({
        entryNodeId: "ring",
        nodes: {
          ring: { id: "ring", type: "ring", groupId: "g-gone", next: "end" },
          end: { id: "end", type: "hangup" },
        },
      }),
    ];
    render(<CallFlowsPage />);

    expect(screen.getByText(/ring a deleted group/)).toBeInTheDocument();
    expect(screen.queryByText(/g-gone/)).not.toBeInTheDocument();
  });

  it("tags a paused flow", () => {
    mocks.flows = [flow({ active: false })];
    render(<CallFlowsPage />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("opens a flow in the builder from its edit icon", () => {
    mocks.flows = [flow()];
    render(<CallFlowsPage />);
    expect(screen.getByRole("link", { name: "Edit Main line" })).toHaveAttribute("href", "/calls/flows/f1");
  });

  it("duplicates a flow from its copy icon", async () => {
    const u = userEvent.setup();
    mocks.flows = [flow()];
    render(<CallFlowsPage />);
    await u.click(screen.getByRole("button", { name: "Duplicate Main line" }));
    expect(mocks.duplicate).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("says what deleting does and does not touch", async () => {
    const u = userEvent.setup();
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    await u.click(screen.getByRole("button", { name: /delete main line/i }));
    expect(screen.getByText(/back to ringing everyone/i)).toBeInTheDocument();
    expect(screen.getByText(/No numbers are released/i)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("f1");
  });

  it("hides every control from someone who can only view settings", () => {
    mocks.can.mockImplementation((_r: string, action?: string) => action !== "edit");
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    expect(screen.getByText("Main line")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create Call Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit Main line" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate Main line" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete main line/i })).not.toBeInTheDocument();
  });
});
