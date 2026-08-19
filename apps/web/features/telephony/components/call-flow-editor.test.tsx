import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow } from "@bitcrm/types";
import { CallFlowEditor } from "./call-flow-editor";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ name: "Main line" })),
  update: vi.fn(async () => ({ name: "Main line" })),
}));

vi.mock("../call-flows-hooks", () => ({
  useCreateCallFlow: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCallFlow: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({
    data: [
      { id: "g1", name: "Dispatch", members: [{ userId: "u1" }] },
      { id: "g2", name: "Office", members: [] },
    ],
  }),
}));

const flow: CallFlow = {
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
};

describe("CallFlowEditor", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.update.mockClear();
  });

  it("creates a flow from the three answers", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<CallFlowEditor open onClose={onClose} />);

    await u.type(screen.getByLabelText("Name"), "Main line");
    await u.type(screen.getByLabelText(/the caller hears/i), "Thanks for calling.");
    await u.selectOptions(screen.getByLabelText(/then ring/i), "g1");
    await u.click(screen.getByRole("button", { name: /create flow/i }));

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Main line",
        greeting: "Thanks for calling.",
        groupId: "g1",
        noAnswer: "voicemail",
        active: true,
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("won't save without a name or a group to ring", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    const save = screen.getByRole("button", { name: /create flow/i });
    expect(save).toBeDisabled();

    await u.type(screen.getByLabelText("Name"), "Main line");
    // A flow that rings nobody is the one thing this form cannot express.
    expect(save).toBeDisabled();

    await u.selectOptions(screen.getByLabelText(/then ring/i), "g1");
    expect(save).toBeEnabled();
  });

  it("reads an existing flow back out of its steps", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByLabelText("Name")).toHaveValue("Main line");
    expect(screen.getByLabelText(/the caller hears/i)).toHaveValue("Thanks for calling.");
    expect(screen.getByLabelText(/then ring/i)).toHaveValue("g1");
    expect(screen.getByText(/541.*283.*0739/)).toBeInTheDocument();
  });

  it("hides the voicemail prompt when the flow just says goodbye", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByPlaceholderText(/leave a message after the tone/i)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /say goodbye/i }));
    expect(screen.queryByPlaceholderText(/leave a message after the tone/i)).not.toBeInTheDocument();
  });

  it("removes a number from the draft without saving", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /remove .*541.*283.*0739/i }));
    expect(screen.getByText(/won't answer anything until one is added/i)).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    await u.click(screen.getByRole("button", { name: /save flow/i }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ numbers: [] }));
  });
});
