import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "@/features/calls/lib";
import { CallClientButton } from "./call-client-button";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  startCall: vi.fn(),
  startBridgedCall: vi.fn(),
  startBridge: vi.fn(),
  setActiveNumber: vi.fn(),
  status: "online" as string,
}));

vi.mock("../softphone-manager", () => ({
  startCall: mocks.startCall,
  startBridgedCall: mocks.startBridgedCall,
}));
vi.mock("../api", () => ({ startBridge: mocks.startBridge }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/lib/api/errors", () => ({
  getApiErrorMessage: (e: unknown) => (e as Error)?.message ?? "Something went wrong",
}));
vi.mock("../softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) =>
    sel({ status: mocks.status, setActiveNumber: mocks.setActiveNumber }),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../numbers-hooks", () => ({
  useNumbers: () => ({
    data: [
      { sid: "PN1", phoneNumber: "+14045551000", friendlyName: "Marietta line" },
      { sid: "PN2", phoneNumber: "+15412830739", friendlyName: "Main line" },
      { sid: "PN3", phoneNumber: "+16025554321", friendlyName: "Phoenix line" },
    ],
  }),
}));

// Two calls with this client: the newest was them ringing our Phoenix line.
const calls: CallRecord[] = [
  {
    callSid: "CA2",
    direction: "inbound",
    from: "+14045551234",
    to: "+16025554321",
    status: "completed",
    startedAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
  },
  {
    callSid: "CA1",
    direction: "outbound",
    from: "+15412830739",
    to: "+14045551234",
    status: "completed",
    startedAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
  },
];

vi.mock("@/features/calls/hooks", () => ({
  useCallsForParty: () => ({ data: { pages: [{ data: calls }] } }),
}));

const open = async (u: ReturnType<typeof userEvent.setup>) =>
  u.click(screen.getByRole("button", { name: /^call .*404.*555-1234$/i }));

describe("CallClientButton", () => {
  beforeEach(() => {
    mocks.startCall.mockClear();
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.setActiveNumber.mockClear();
    mocks.status = "online";
  });

  it("stays out of the way until it's clicked", () => {
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    expect(screen.queryByText(/from which of our numbers/i)).not.toBeInTheDocument();
  });

  it("drops the popover directly under the button, aligned to its left edge", async () => {
    const u = userEvent.setup();
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    await open(u);

    const panel = screen.getByPlaceholderText(/search our numbers/i).closest("div.absolute");
    expect(panel).not.toBeNull();
    // Anchored under the button (top-full) and to its left edge, not hanging
    // off to the left via right-0.
    expect(panel).toHaveClass("left-0");
    expect(panel).toHaveClass("top-full");
    expect(panel?.className).not.toContain("right-0");
  });

  it("offers the numbers this client has spoken to, newest first and dated", async () => {
    const u = userEvent.setup();
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    await open(u);

    const recent = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => t.includes("They called") || t.includes("We called"));

    expect(recent).toHaveLength(2);
    expect(recent[0]).toContain("(602) 555-4321"); // the more recent
    expect(recent[0]).toContain("They called");
    expect(recent[1]).toContain("(541) 283-0739");
  });

  it("dials from the number that was picked", async () => {
    const u = userEvent.setup();
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    await open(u);
    await u.click(screen.getByRole("button", { name: /602.*555.*4321/ }));

    expect(mocks.setActiveNumber).toHaveBeenCalledWith("+16025554321");
    expect(mocks.startCall).toHaveBeenCalledWith("+14045551234");
  });

  it("keeps every other number of ours a search away", async () => {
    const u = userEvent.setup();
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    await open(u);

    // The two already offered above aren't repeated in the searchable list.
    expect(screen.getByText("Other numbers")).toBeInTheDocument();
    await u.type(screen.getByPlaceholderText(/search our numbers/i), "marietta");
    await u.click(screen.getByText("Marietta line"));

    expect(mocks.setActiveNumber).toHaveBeenCalledWith("+14045551000");
    expect(mocks.startCall).toHaveBeenCalledWith("+14045551234");
  });

  it("says the phone is off rather than failing silently on the click", async () => {
    mocks.status = "offline";
    const u = userEvent.setup();
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    await open(u);

    expect(screen.getByText(/turn the phone on/i)).toBeInTheDocument();
  });
});

/**
 * With a job in scope the button places a MASKED call: it sends a handle, not
 * a number, and the client's phone never reaches this component. Without one
 * — a contact or company record, where there is no job to authorise against —
 * it keeps dialling the number directly.
 */
describe("CallClientButton — masked bridge", () => {
  beforeEach(() => {
    mocks.startBridge.mockReset();
    mocks.startBridgedCall.mockReset();
    mocks.startCall.mockReset();
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    // Registered by default — the cases about an unregistered browser say so.
    mocks.status = "online";
    mocks.startBridge.mockResolvedValue({
      bridgeId: "b-1",
      mode: "softphone",
      clientName: "Maria Alvarez",
    });
  });

  /**
   * Opening the client's record and pressing call is one gesture; deciding
   * WHICH phone rings is a different one, and the technician is the only one
   * who knows. Presence guesses it wrong exactly when it matters — the app
   * open on a laptop in the van, the phone in their hand.
   */
  const chooseMyPhone = async () => {
    await userEvent.click(screen.getByRole("button", { name: /call/i }));
    await userEvent.click(screen.getByRole("button", { name: /my phone/i }));
  };
  const chooseBrowser = async () => {
    await userEvent.click(screen.getByRole("button", { name: /call/i }));
    await userEvent.click(screen.getByRole("button", { name: /this browser/i }));
  };

  it("offers both ends before placing anything", async () => {
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await userEvent.click(screen.getByRole("button", { name: /call/i }));

    expect(screen.getByRole("button", { name: /my phone/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /this browser/i })).toBeInTheDocument();
    expect(mocks.startBridge).not.toHaveBeenCalled();
  });

  it("says what will happen when they pick their own phone", async () => {
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await userEvent.click(screen.getByRole("button", { name: /call/i }));

    expect(screen.getByText(/we ring you, then the client/i)).toBeInTheDocument();
  });

  it("sends a handle rather than a number when a job is in scope", async () => {
    render(
      <CallClientButton
        to="+14045551234"
        partyId="contact-1"
        dealId="deal-1"
        contactId="contact-1"
        phoneIndex={0}
      />,
    );

    await chooseBrowser();

    expect(mocks.startBridge).toHaveBeenCalledWith({
      dealId: "deal-1",
      contactId: "contact-1",
      phoneIndex: 0,
      via: "softphone",
    });
    expect(mocks.startCall).not.toHaveBeenCalled();
  });

  /** The whole point of the choice: it must beat presence, not follow it. */
  it("rings their handset when they ask for it, softphone or not", async () => {
    mocks.status = "online";
    mocks.startBridge.mockResolvedValue({
      bridgeId: "b-2",
      mode: "cell",
      clientName: "Maria Alvarez",
    });
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await chooseMyPhone();

    expect(mocks.startBridge).toHaveBeenCalledWith(
      expect.objectContaining({ via: "cell" }),
    );
    expect(mocks.startBridgedCall).not.toHaveBeenCalled();
  });

  it("connects the browser leg when the server says softphone", async () => {
    render(
      <CallClientButton to="+14045551234" dealId="deal-1" contactId="contact-1" />,
    );

    await chooseBrowser();

    expect(mocks.startBridgedCall).toHaveBeenCalledWith("b-1", "Maria Alvarez");
  });

  it("does not connect a browser leg when the handset is being rung", async () => {
    mocks.startBridge.mockResolvedValue({ bridgeId: "b-2", mode: "cell" });
    render(
      <CallClientButton to="+14045551234" dealId="deal-1" contactId="contact-1" />,
    );

    await chooseMyPhone();

    expect(mocks.startBridgedCall).not.toHaveBeenCalled();
  });

  /** Dialling from a browser that is not registered would fail silently at the
   *  Twilio device; better to say so than to look broken. */
  it("will not send them down the browser path with the phone off", async () => {
    mocks.status = "offline";
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await userEvent.click(screen.getByRole("button", { name: /call/i }));

    expect(screen.getByRole("button", { name: /this browser/i })).toBeDisabled();
    expect(screen.getByText(/turn the phone on/i)).toBeInTheDocument();
  });

  it("falls back to the caller-id picker with no job in scope", async () => {
    render(<CallClientButton to="+14045551234" partyId="contact-1" />);

    await userEvent.click(
      screen.getByRole("button", { name: "Call +1 (404) 555-1234" }),
    );

    // The distinction that matters: masked places the call on one tap, while
    // unmasked opens the caller-id picker and waits for a choice.
    expect(mocks.startBridge).not.toHaveBeenCalled();
    expect(mocks.startCall).not.toHaveBeenCalled();
    expect(screen.getByText("Marietta line")).toBeInTheDocument();
  });

  /**
   * A masked technician has no number to render, so the button must still be
   * offered — otherwise the only way to reach the client disappears with it.
   */
  it("renders with a job in scope even when there is no number to show", () => {
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);
    expect(screen.getByRole("button", { name: /call/i })).toBeInTheDocument();
  });

  /**
   * The bug a technician actually hits: their profile has no phone number, the
   * server says so in a sentence written for them, and the button used to
   * swallow it — so pressing it did nothing at all, with no way to find out
   * why. Reaching the client is the whole job; a silent failure is the worst
   * possible outcome here.
   */
  describe("when the bridge cannot be placed", () => {
    it("tells the technician what went wrong", async () => {
      mocks.startBridge.mockRejectedValue(
        new Error("No phone number on file for you"),
      );
      render(
        <CallClientButton to="" dealId="deal-1" contactId="contact-1" />,
      );

      await chooseMyPhone();

      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining("No phone number on file for you"),
      );
    });

    it("lets them try again rather than staying stuck", async () => {
      mocks.startBridge.mockRejectedValue(new Error("nope"));
      render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

      await chooseMyPhone();

      expect(screen.getByRole("button", { name: /call/i })).not.toBeDisabled();
    });
  });

  /**
   * On the cell path the technician's own handset rings first, seconds later,
   * from a number they do not recognise. Without being told, they decline it —
   * so the call that was placed for them never happens.
   */
  it("says the handset is about to ring on the cell path", async () => {
    mocks.startBridge.mockResolvedValue({
      bridgeId: "b-2",
      mode: "cell",
      clientName: "Maria Alvarez",
    });
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await chooseMyPhone();

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/answer|your phone/i),
    );
  });

  /** On the softphone path the dialer is already visible — a toast would just
   *  repeat what the screen says. */
  it("stays quiet when the browser leg opens instead", async () => {
    mocks.startBridge.mockResolvedValue({
      bridgeId: "b-1",
      mode: "softphone",
      clientName: "Maria Alvarez",
    });
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await chooseBrowser();

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  /** Two taps must not place two calls — the second one would ring a client
   *  who is already talking to somebody. */
  it("cannot be pressed twice while it is placing the call", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.startBridge.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    await chooseMyPhone();
    await chooseMyPhone().catch(() => undefined);

    expect(mocks.startBridge).toHaveBeenCalledTimes(1);
    release({ bridgeId: "b-1", mode: "softphone", clientName: "Maria" });
  });

  /** The masked button is not the same action as the plain one — it puts the
   *  system between two people — and must not look identical to it. */
  /**
   * On a job page the technician is not scanning a dense list of numbers —
   * they are looking for the one way to reach the client, often on a phone,
   * often outside somebody's house. A 28px ghost icon reads as decoration
   * there; the office's contact list is where that density earns its keep.
   */
  describe("prominent variant", () => {
    it("wears a label rather than a bare icon", () => {
      render(
        <CallClientButton to="" dealId="deal-1" contactId="contact-1" variant="prominent" />,
      );

      const trigger = screen.getByRole("button", { name: /call client/i });
      expect(trigger).toHaveTextContent(/call client/i);
    });

    it("stays icon-only by default, for the office's dense lists", () => {
      render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

      expect(screen.getByRole("button", { name: /call client/i })).toHaveTextContent("");
    });

    it("opens the same two-ends picker", async () => {
      render(
        <CallClientButton to="" dealId="deal-1" contactId="contact-1" variant="prominent" />,
      );

      await userEvent.click(screen.getByRole("button", { name: /call client/i }));

      expect(screen.getByRole("button", { name: /my phone/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /this browser/i })).toBeInTheDocument();
    });

    it("says it is working while the bridge is being placed", async () => {
      let release: (v: unknown) => void = () => {};
      mocks.startBridge.mockReturnValue(new Promise((r) => (release = r)));
      render(
        <CallClientButton to="" dealId="deal-1" contactId="contact-1" variant="prominent" />,
      );

      await userEvent.click(screen.getByRole("button", { name: /call client/i }));
      await userEvent.click(screen.getByRole("button", { name: /my phone/i }));

      const trigger = screen.getByRole("button", { name: /calling/i });
      expect(trigger).toHaveTextContent(/calling/i);
      expect(trigger).toBeDisabled();

      release({ bridgeId: "b-1", mode: "cell" });
    });
  });

  it("names the masked action so it is findable", () => {
    render(<CallClientButton to="" dealId="deal-1" contactId="contact-1" />);

    expect(
      screen.getByRole("button", { name: /call client/i }),
    ).toHaveAttribute("title", expect.stringMatching(/without showing|hidden|masked/i));
  });
});
