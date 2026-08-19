import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow, CallFlowNode } from "@bitcrm/types";
import { CallFlowEditor } from "./call-flow-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async (_body: { nodes: Record<string, unknown>; numbers: string[] }) => ({
    name: "Main line",
  })),
  upload: vi.fn((_file: File) => undefined),
}));

vi.mock("../call-flows-hooks", () => ({
  useSaveCallFlow: () => ({ mutateAsync: mocks.save, isPending: false }),
  useUploadFlowAudio: () => ({ mutate: mocks.upload, isPending: false }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({
    data: [
      { id: "g1", name: "Dispatch", members: [] },
      { id: "g2", name: "On call", members: [] },
    ],
  }),
}));

const flow: CallFlow = {
  id: "f1",
  name: "Main line",
  numbers: ["+15412830739"],
  entryNodeId: "hello",
  nodes: {
    hello: { id: "hello", type: "say", text: "Thanks for calling.", next: "ring" },
    ring: { id: "ring", type: "ring", groupId: "g1", next: "vm" },
    vm: { id: "vm", type: "voicemail", prompt: "Leave a message.", maxSeconds: 120 },
  },
  active: true,
  version: 1,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

/** The graph the editor sent on the last save. */
const savedNodes = (): Record<string, CallFlowNode> =>
  mocks.save.mock.calls[0][0].nodes as Record<string, CallFlowNode>;

describe("CallFlowEditor", () => {
  beforeEach(() => {
    mocks.save.mockClear();
    mocks.upload.mockClear();
  });

  /** The step cards on screen, in order — each one has a Remove button. */
  const stepNames = () =>
    screen
      .getAllByRole("button", { name: /^Remove (?!key|\+)/ })
      .map((b) => b.getAttribute("aria-label")?.replace("Remove ", ""));

  it("opens a new flow on a working starter: greet, ring, take a message", () => {
    render(<CallFlowEditor open onClose={vi.fn()} />);

    expect(stepNames()).toEqual([
      "Say something",
      "Ring a group",
      "Take a message",
    ]);
  });

  it("lists an existing flow as steps, in the order a call meets them", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(stepNames()).toEqual([
      "Say something",
      "Ring a group",
      "Take a message",
    ]);
    expect(screen.getByDisplayValue("Thanks for calling.")).toBeInTheDocument();
  });

  it("chains one group into the next — the thing a flow exists for", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // Try dispatch, then the on-call tech, then take a message.
    await u.click(screen.getByRole("button", { name: "Add step: Ring a group" }));
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const nodes = Object.values(savedNodes());
    const rings = nodes.filter((n) => n.type === "ring");
    expect(rings).toHaveLength(2);
    // The new step lands on the end of the line, so the chain really chains.
    expect(nodes.find((n) => n.type === "voicemail")?.next).toBe(rings[1].id);
  });

  it("adds a voice menu with keys that lead somewhere", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Add step: Voice menu" }));
    await u.click(screen.getByRole("button", { name: /add a key/i }));

    await u.type(screen.getByLabelText("Label 1"), "Dispatch");
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const menu = Object.values(savedNodes()).find((n) => n.type === "menu");
    expect(menu).toMatchObject({ options: [{ key: "1", label: "Dispatch" }] });
  });

  it("offers opening hours per day, with both branches", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Add step: Business hours" }));

    expect(screen.getByLabelText("When open")).toBeInTheDocument();
    expect(screen.getByLabelText("When closed")).toBeInTheDocument();
    // Weekdays are on by default; the weekend is not.
    expect(screen.getByLabelText("Mon")).toBeChecked();
    expect(screen.getByLabelText("Sun")).not.toBeChecked();
  });

  it("can require a keypress from personal phones, and says why", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByLabelText(/press a key first/i));
    expect(screen.getByText(/voicemail answering and taking the call/i)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /save flow/i }));
    const ring = Object.values(savedNodes()).find((n) => n.type === "ring");
    expect(ring).toMatchObject({ whisper: true });
  });

  it("heals the chain when a step in the middle is deleted", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /remove ring a group/i }));
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const nodes = savedNodes();
    expect(Object.keys(nodes)).toEqual(["hello", "vm"]);
    // The greeting now leads straight to voicemail rather than nowhere.
    expect(nodes.hello.next).toBe("vm");
  });

  it("won't save a flow with no name", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /create flow/i })).toBeDisabled();
    await u.type(screen.getByLabelText("Name"), "Main line");
    expect(screen.getByRole("button", { name: /create flow/i })).toBeEnabled();
  });

  it("removes a number from the draft without saving", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /remove .*541.*283.*0739/i }));
    expect(screen.getByText(/won't answer anything until one is added/i)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();

    await u.click(screen.getByRole("button", { name: /save flow/i }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ numbers: [] }));
  });

  it("uploads a recorded greeting instead of speaking the text", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // The dialog renders in a portal, so it isn't under `container`.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(["audio"], "greeting.mp3", { type: "audio/mpeg" }));

    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.upload.mock.calls[0][0].name).toBe("greeting.mp3");
  });
});
