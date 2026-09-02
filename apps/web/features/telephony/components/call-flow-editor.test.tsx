import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallFlow, CallFlowNode } from "@bitcrm/types";
import { CallFlowEditor } from "./call-flow-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(
    async (_body: {
      nodes: Record<string, unknown>;
      numbers: string[];
      entryNodeId: string;
      name: string;
      active: boolean;
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

/** The step cards on the canvas, in the order they are drawn. */
const cards = () =>
  screen
    .getAllByRole("button", { name: /^Edit .+ — / })
    .map((b) => b.getAttribute("aria-label")!.replace("Edit ", "").split(" — ")[0]);

/** Every `+` on the canvas, in layout order. */
const plusButtons = () => screen.getAllByRole("button", { name: "Add a step" });

const openBasicInfo = async (u: ReturnType<typeof userEvent.setup>) =>
  u.click(screen.getByRole("button", { name: "Edit the flow's name and numbers" }));

const openNumbers = async (u: ReturnType<typeof userEvent.setup>) => {
  await openBasicInfo(u);
  await u.click(screen.getByRole("button", { name: "Choose numbers" }));
};

describe("CallFlowEditor", () => {
  beforeEach(() => {
    mocks.save.mockClear();
    mocks.upload.mockClear();
    mocks.flows = [];
  });

  it("draws the call as a map, starting from the number that was dialled", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByText("Incoming call")).toBeInTheDocument();
    expect(screen.getByText(/To: .*541.*283.*0739/)).toBeInTheDocument();
    expect(cards()).toEqual(["Say something", "Ring a group", "Take a message"]);
  });

  it("summarises each step on its card, without opening anything", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByText("Thanks for calling.")).toBeInTheDocument();
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByText("Records up to 120s")).toBeInTheDocument();
  });

  it("opens a step in the side panel, and never asks where to go next", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Ring a group — ") }));

    expect(screen.getByRole("dialog", { name: "Ring a group" })).toBeInTheDocument();
    expect(screen.getByLabelText("Call group")).toBeInTheDocument();
    // Order is the wiring, so there is no "and then…" anywhere.
    expect(screen.queryByLabelText(/If nobody answers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/End the call/)).not.toBeInTheDocument();
  });

  it("closes the panel and leaves the canvas as it was", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Ring a group — ") }));
    await u.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Ring a group" })).not.toBeInTheDocument();
    expect(cards()).toEqual(["Say something", "Ring a group", "Take a message"]);
  });

  it("wires the saved flow from the order on screen", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: /save call flow/i }));

    const nodes = savedNodes();
    expect(saved().entryNodeId).toBe("hello");
    expect(nodes.hello.next).toBe("ring");
    expect(nodes.ring.next).toBe("vm");
    expect(nodes.vm.next).toBeUndefined();
  });

  it("shows ringing as two outcomes, named on the lines that leave it", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    // The distinction that caused a closing message to reach only the callers
    // nobody picked up for.
    expect(screen.getByText("After the call")).toBeInTheDocument();
    expect(screen.getByText("If nobody answers")).toBeInTheDocument();
  });

  describe("adding a step", () => {
    /**
     * The `+` on every connector is the whole editing model: where you press
     * is where the step lands, so there is never a second question about
     * position.
     */
    it("offers an insert point on every connector, both ends included", () => {
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      // before hello · between hello and ring · the empty answered branch ·
      // before voicemail · after voicemail
      expect(plusButtons()).toHaveLength(5);
    });

    it("lands the step exactly where the + was pressed", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      // The very first connector — above the greeting that opens the flow.
      await u.click(plusButtons()[0]);
      await u.click(screen.getByRole("button", { name: /^Business hours/ }));

      expect(cards()[0]).toBe("Business hours");
    });

    it("puts a closing message on the answered path, where it is heard", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      // The third `+` is the ring's empty "After the call" branch.
      await u.click(plusButtons()[2]);
      await u.click(screen.getByRole("button", { name: /^Say something/ }));
      await u.click(screen.getByRole("button", { name: /save call flow/i }));

      const ring = savedNodes().ring as Extract<CallFlowNode, { type: "ring" }>;
      expect(ring.answeredNext).toBeTruthy();
      expect(ring.next).toBe("vm");
    });

    it("escalates one group to the next, down the no-answer path", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      // The last `+` is under the voicemail on the no-answer branch: try
      // dispatch, then take a message, then ring the on-call tech.
      const all = plusButtons();
      await u.click(all[all.length - 1]);
      await u.click(screen.getByRole("button", { name: /^Ring a group/ }));
      await u.click(screen.getByRole("button", { name: /save call flow/i }));

      const nodes = savedNodes();
      const rings = Object.values(nodes).filter((n) => n.type === "ring");
      expect(rings).toHaveLength(2);
      expect(nodes.vm.next).toBe(rings[1].id);
    });

    it("says what each kind of step does before you pick one", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      await u.click(plusButtons()[0]);

      expect(screen.getByRole("dialog", { name: "Add a step" })).toBeInTheDocument();
      expect(screen.getByText(/one path per key/i)).toBeInTheDocument();
    });
  });

  it("gives a menu one path per key, plus one for pressing nothing", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Close panel" }));
    await u.click(plusButtons()[0]);
    await u.click(screen.getByRole("button", { name: /^Voice menu/ }));
    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Voice menu — ") }));
    await u.click(screen.getByRole("button", { name: /add a key/i }));
    await u.click(screen.getByRole("button", { name: "Close" }));

    // One labelled line per key, and one for the caller who presses nothing.
    expect(screen.getByText("Press 1")).toBeInTheDocument();
    expect(screen.getByText("Presses nothing")).toBeInTheDocument();
  });

  it("labels both sides of an hours split", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: "Close panel" }));
    await u.click(plusButtons()[0]);
    await u.click(screen.getByRole("button", { name: /^Business hours/ }));

    expect(screen.getByText("While open")).toBeInTheDocument();
    expect(screen.getByText("While closed")).toBeInTheDocument();
  });

  it("deletes a step from its panel, and what hung off it goes too", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Ring a group — ") }));
    await u.click(screen.getByRole("button", { name: "Remove Ring a group" }));
    await u.click(screen.getByRole("button", { name: /save call flow/i }));

    // Voicemail only existed as the ring's no-answer path.
    expect(Object.keys(savedNodes())).toEqual(["hello"]);
    expect(savedNodes().hello.next).toBeUndefined();
  });

  /**
   * The canvas has no drag handles — position is chosen by which `+` you
   * press — so reordering an existing step lives where the step does.
   */
  it("moves a step earlier from its own panel", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(plusButtons()[1]);
    await u.click(screen.getByRole("button", { name: /^Hang up/ }));
    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Hang up — ") }));
    await u.click(screen.getByRole("button", { name: "Move Hang up earlier" }));

    expect(cards()).toEqual([
      "Hang up",
      "Say something",
      "Ring a group",
      "Take a message",
    ]);
  });

  it("won't offer to move the only step in a branch", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Take a message — ") }));

    expect(
      screen.queryByRole("button", { name: /Move Take a message/ }),
    ).not.toBeInTheDocument();
  });

  /**
   * A branching step has to stay last in its sequence, so the canvas never
   * offers to move it — doing so would strand everything drawn below it.
   */
  it("won't offer to move a step that splits the call", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Ring a group — ") }));

    expect(
      screen.queryByRole("button", { name: /Move Ring a group/ }),
    ).not.toBeInTheDocument();
  });

  describe("basic info", () => {
    it("opens on the name for a flow that has never been saved", () => {
      render(<CallFlowEditor open onClose={vi.fn()} />);

      expect(screen.getByRole("dialog", { name: "Basic info" })).toBeInTheDocument();
      expect(screen.getByLabelText("Flow name")).toHaveValue("");
    });

    it("won't save a flow with no name", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor open onClose={vi.fn()} />);

      expect(screen.getByRole("button", { name: /create call flow/i })).toBeDisabled();
      await u.type(screen.getByLabelText("Flow name"), "Main line");
      await u.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("button", { name: /create call flow/i })).toBeEnabled();
    });

    it("puts the name and numbers in the builder's header", () => {
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      expect(screen.getByRole("heading", { name: "Main line" })).toBeInTheDocument();
    });

    it("throws away an edit that was cancelled", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

      await openBasicInfo(u);
      await u.clear(screen.getByLabelText("Flow name"));
      await u.type(screen.getByLabelText("Flow name"), "Renamed");
      await u.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.getByRole("heading", { name: "Main line" })).toBeInTheDocument();
    });
  });

  describe("the numbers it answers", () => {
    it("offers the workspace's own numbers, not a free-text field", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);
      await openNumbers(u);

      // A number we don't own could never ring, so typing one is not offered.
      expect(screen.queryByPlaceholderText(/add a number/i)).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /541.*283.*0739/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /404.*555.*0100/ })).not.toBeChecked();
    });

    it("picks up and drops a number", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);
      await openNumbers(u);

      await u.click(screen.getByRole("checkbox", { name: /404.*555.*0100/ }));
      await u.click(screen.getByRole("checkbox", { name: /541.*283.*0739/ }));
      await u.click(screen.getByRole("button", { name: "Save" }));
      await u.click(screen.getByRole("button", { name: /save call flow/i }));

      expect(saved().numbers).toEqual(["+14045550100"]);
    });

    it("drops a number straight from its chip", async () => {
      const u = userEvent.setup();
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);
      await openBasicInfo(u);

      await u.click(screen.getByRole("button", { name: /Stop answering .*541.*283.*0739/ }));
      expect(screen.getByText("No numbers assigned")).toBeInTheDocument();

      // And the header, which is what you see once the panel is closed.
      await u.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByText("No numbers yet")).toBeInTheDocument();
    });

    it("says which flow already answers a number, instead of failing on save", async () => {
      const u = userEvent.setup();
      mocks.flows = [{ ...flow, id: "other", name: "After hours", numbers: ["+14045550100"] }];
      render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);
      await openNumbers(u);

      expect(screen.getByText("answered by After hours")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /404.*555.*0100/ })).toBeDisabled();
    });

    it("points somebody with no numbers at where to get one", async () => {
      const u = userEvent.setup();
      mocks.numbers = [];
      render(<CallFlowEditor open onClose={vi.fn()} />);
      await u.click(screen.getByRole("button", { name: "Choose numbers" }));

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

  it("uploads a recorded greeting in place of the words", async () => {
    const u = userEvent.setup();
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    await u.click(screen.getByRole("button", { name: new RegExp("^Edit Say something — ") }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(["x"], "greeting.mp3", { type: "audio/mpeg" }));

    expect(mocks.upload.mock.calls[0][0].name).toBe("greeting.mp3");
  });

  it("offers the canvas controls that make a big flow navigable", () => {
    render(<CallFlowEditor flow={flow} open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit the flow/i })).toBeInTheDocument();
  });
});
