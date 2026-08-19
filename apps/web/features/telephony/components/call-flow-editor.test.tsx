import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow, CallFlowNode } from "@bitcrm/types";
import { CallFlowEditor } from "./call-flow-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(
    async (_body: {
      nodes: Record<string, unknown>;
      numbers: string[];
      entryNodeId: string;
    }) => ({ name: "Main line" }),
  ),
  upload: vi.fn((_file: File) => undefined),
  numbers: [
    { sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main" },
    { sid: "PN2", phoneNumber: "+14045550100", friendlyName: "Ads" },
  ],
  flows: [] as CallFlow[],
}));

vi.mock("../call-flows-hooks", () => ({
  useSaveCallFlow: () => ({ mutateAsync: mocks.save, isPending: false }),
  useUploadFlowAudio: () => ({ mutate: mocks.upload, isPending: false }),
  useCallFlows: () => ({ data: mocks.flows }),
}));
vi.mock("../call-groups-hooks", () => ({
  useCallGroups: () => ({
    data: [
      { id: "g1", name: "Dispatch", members: [] },
      { id: "g2", name: "On call", members: [] },
    ],
  }),
}));
vi.mock("../numbers-hooks", () => ({
  useNumbers: () => ({ data: mocks.numbers, isLoading: false }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const flow: CallFlow = {
  id: "f1",
  name: "Main line",
  numbers: ["+15412830739"],
  entryNodeId: "hello",
  nodes: {
    hello: { id: "hello", type: "say", text: "Thanks for calling.", next: "ring" },
    // `next` is the no-answer path; a step after the conversation would be
    // `answeredNext`.
    ring: { id: "ring", type: "ring", groupId: "g1", next: "vm" },
    vm: { id: "vm", type: "voicemail", prompt: "Leave a message.", maxSeconds: 120 },
  },
  active: true,
  version: 1,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const saved = () => mocks.save.mock.calls[0][0];
const savedNodes = () => saved().nodes as Record<string, CallFlowNode>;
/** Step cards, in the order they are drawn. */
const stepNames = () =>
  screen
    .getAllByRole("button", { name: /^Remove (?!key)/ })
    .map((b) => b.getAttribute("aria-label")?.replace("Remove ", ""));

describe("CallFlowEditor", () => {
  beforeEach(() => {
    mocks.save.mockClear();
    mocks.upload.mockClear();
    mocks.flows = [];
  });

  it("shows the call top to bottom, between ringing and hanging up", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByText("Somebody calls")).toBeInTheDocument();
    expect(stepNames()).toEqual(["Say something", "Ring a group", "Take a message"]);
    expect(screen.getByText("Call ends")).toBeInTheDocument();
  });

  it("summarises each step without opening it", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByText("Thanks for calling.")).toBeInTheDocument();
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByText("Records up to 120s")).toBeInTheDocument();
  });

  it("opens a step to edit it, and never asks where to go next", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Edit Ring a group" }));

    expect(screen.getByLabelText("Call group")).toBeInTheDocument();
    // Order is the wiring, so there is no "and then…" anywhere.
    expect(screen.queryByLabelText(/If nobody answers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/End the call/)).not.toBeInTheDocument();
  });

  it("wires the saved flow from the order on screen", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const nodes = savedNodes();
    expect(saved().entryNodeId).toBe("hello");
    expect(nodes.hello.next).toBe("ring");
    expect(nodes.ring.next).toBe("vm");
    expect(nodes.vm.next).toBeUndefined();
  });

  it("escalates one group to the next, down the no-answer path", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // Under "If nobody answers" there is already voicemail; add a second group
    // after it — try dispatch, then the on-call tech, then take a message.
    const addButtons = screen.getAllByRole("button", { name: /add a step/i });
    await u.click(addButtons[addButtons.length - 1]);
    await u.click(screen.getByRole("button", { name: "Ring a group" }));
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const nodes = savedNodes();
    const rings = Object.values(nodes).filter((n) => n.type === "ring");
    expect(rings).toHaveLength(2);
    // The first group's no-answer path leads on to the second.
    expect(nodes.vm.next).toBe(rings[1].id);
  });

  it("shows ringing as two outcomes, not one next step", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // The distinction that caused a closing message to reach only the callers
    // nobody picked up for.
    expect(screen.getByText("After the call")).toBeInTheDocument();
    expect(screen.getByText("If nobody answers")).toBeInTheDocument();
  });

  it("puts a closing message on the answered path, where it is heard", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // The first "add a step" under the ring belongs to "After the call".
    const addButtons = screen.getAllByRole("button", { name: /add a step/i });
    await u.click(addButtons[0]);
    await u.click(screen.getByRole("button", { name: "Say something" }));
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    const nodes = savedNodes();
    const ring = nodes.ring as Extract<CallFlowNode, { type: "ring" }>;
    expect(ring.answeredNext).toBeTruthy();
    expect(ring.next).toBe("vm");
  });

  it("gives a menu one path per key, plus one for pressing nothing", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /add a step/i }));
    await u.click(screen.getByRole("button", { name: "Voice menu" }));
    await u.click(screen.getByRole("button", { name: "Edit Voice menu" }));
    await u.click(screen.getByRole("button", { name: /add a key/i }));

    // One labelled path per key, and one for the caller who presses nothing.
    expect(screen.getByText("Press 1")).toBeInTheDocument();
    expect(screen.getByText("Presses nothing")).toBeInTheDocument();
  });

  it("labels both sides of an hours split", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /add a step/i }));
    await u.click(screen.getByRole("button", { name: "Business hours" }));

    expect(screen.getByText("While open")).toBeInTheDocument();
    expect(screen.getByText("While closed")).toBeInTheDocument();
  });

  it("deletes a step, and what hung off it goes too", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Remove Ring a group" }));
    await u.click(screen.getByRole("button", { name: /save flow/i }));

    // Voicemail only existed as the ring's no-answer path.
    expect(Object.keys(savedNodes())).toEqual(["hello"]);
    expect(savedNodes().hello.next).toBeUndefined();
  });

  describe("the numbers it answers", () => {
    it("offers the workspace's own numbers, not a free-text field", () => {
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      // A number we don't own could never ring, so typing one is not offered.
      expect(screen.queryByPlaceholderText(/add a number/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/541.*283.*0739/)).toBeChecked();
      expect(screen.getByLabelText(/404.*555.*0100/)).not.toBeChecked();
    });

    it("picks up and drops a number", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      await u.click(screen.getByLabelText(/404.*555.*0100/));
      await u.click(screen.getByLabelText(/541.*283.*0739/));
      await u.click(screen.getByRole("button", { name: /save flow/i }));

      expect(saved().numbers).toEqual(["+14045550100"]);
    });

    it("says which flow already answers a number, instead of failing on save", () => {
      mocks.flows = [{ ...flow, id: "other", name: "After hours", numbers: ["+14045550100"] }];
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      expect(screen.getByText("answered by After hours")).toBeInTheDocument();
      expect(screen.getByLabelText(/404.*555.*0100/)).toBeDisabled();
    });

    it("points somebody with no numbers at where to get one", () => {
      mocks.numbers = [];
      render(<CallFlowEditor open onClose={vi.fn()} />);

      expect(screen.getByRole("link", { name: /buy one/i })).toHaveAttribute(
        "href",
        "/settings/phone-numbers",
      );
      mocks.numbers = [
        { sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main" },
        { sid: "PN2", phoneNumber: "+14045550100", friendlyName: "Ads" },
      ];
    });
  });

  it("won't save a flow with no name", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /create flow/i })).toBeDisabled();
    await u.type(screen.getByLabelText("Name"), "Main line");
    expect(screen.getByRole("button", { name: /create flow/i })).toBeEnabled();
  });

  it("uploads a recorded greeting in place of the words", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Edit Say something" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(["x"], "greeting.mp3", { type: "audio/mpeg" }));

    expect(mocks.upload.mock.calls[0][0].name).toBe("greeting.mp3");
  });
});
