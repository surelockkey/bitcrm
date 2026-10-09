import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow } from "@bitcrm/types";
import { CallFlowsPage } from "./call-flows-page";

const mocks = vi.hoisted(() => ({
  flows: [] as CallFlow[],
  remove: vi.fn(),
  duplicate: vi.fn(),
  can: vi.fn((_resource: string, _action?: string) => true),
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
  });

  it("draws Workiz's words, Create Call Flow and the columns", () => {
    mocks.flows = [flow()];
    render(<CallFlowsPage />);
    expect(screen.getByText(/Call flows route your calls to where they need to go/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Call Flow" })).toHaveAttribute("href", "/calls/flows/new");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Numbers", "Steps", "Actions"]);
  });

  it("summarises what a flow actually does, in order, beside its numbers", () => {
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    expect(screen.getByText("Main line")).toBeInTheDocument();
    expect(screen.getByText("greeting → ring Dispatch → voicemail")).toBeInTheDocument();
    expect(screen.getByText("(541) 283-0739")).toBeInTheDocument();
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
