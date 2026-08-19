import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow } from "@bitcrm/types";
import { CallFlowsPage } from "./call-flows-page";

const mocks = vi.hoisted(() => ({
  flows: [] as CallFlow[],
  remove: vi.fn(),
  can: vi.fn((_resource: string, _action?: string) => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../call-flows-hooks", () => ({
  useCallFlows: () => ({ data: mocks.flows, isLoading: false }),
  useDeleteCallFlow: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({ data: [{ id: "g1", name: "Dispatch", members: [] }] }),
}));
vi.mock("./call-flow-editor", () => ({
  CallFlowEditor: ({ flow }: { flow?: CallFlow }) => (
    <div data-testid="editor">{flow ? `editing ${flow.name}` : "creating"}</div>
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

describe("CallFlowsPage", () => {
  beforeEach(() => {
    mocks.flows = [];
    mocks.remove.mockClear();
    mocks.can.mockReturnValue(true);
  });

  it("explains what a flow is for when there are none", () => {
    render(<CallFlowsPage />);
    expect(screen.getByText(/no call flows yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/rings whoever has the phone switched on/i),
    ).toBeInTheDocument();
  });

  it("summarises what a flow actually does, in order", () => {
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    expect(screen.getByText("Main line")).toBeInTheDocument();
    expect(screen.getByText("greeting → ring Dispatch → voicemail")).toBeInTheDocument();
    expect(screen.getByText(/541.*283.*0739/)).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("says a flow answers nothing when it has no numbers", () => {
    mocks.flows = [flow({ numbers: [] })];
    render(<CallFlowsPage />);
    expect(screen.getByText(/answers nothing yet/i)).toBeInTheDocument();
  });

  it("names a group that has been deleted rather than showing a bare id", () => {
    mocks.flows = [
      flow({
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

  it("shows a paused flow as paused", () => {
    mocks.flows = [flow({ active: false })];
    render(<CallFlowsPage />);
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("opens the editor for a flow", async () => {
    const u = userEvent.setup();
    mocks.flows = [flow()];
    render(<CallFlowsPage />);

    await u.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("editor")).toHaveTextContent("editing Main line");
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
    expect(screen.queryByRole("button", { name: /new flow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
