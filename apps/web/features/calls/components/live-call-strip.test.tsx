import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "../lib";
import { LiveCallStrip } from "./live-call-strip";

const callState = vi.fn(() => "active");
const activeCall = vi.fn<() => { data: CallRecord | null }>();
const linkMutate = vi.fn();

vi.mock("@/features/telephony/softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) =>
    sel({ callState: callState() }),
}));
vi.mock("@/features/telephony/use-call-timer", () => ({
  useCallTimer: () => "1:07",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useActiveCall: () => activeCall(),
  useLinkCallToDeal: () => ({ mutate: linkMutate, isPending: false }),
}));

const call: CallRecord = {
  callSid: "CA1",
  direction: "inbound",
  from: "+14045551234",
  to: "+15412830739",
  status: "in-progress",
  startedAt: "2026-08-14T10:00:00.000Z",
  updatedAt: "2026-08-14T10:00:00.000Z",
  answeredAt: "2026-08-14T10:00:05.000Z",
  fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
};

describe("LiveCallStrip", () => {
  beforeEach(() => {
    callState.mockReturnValue("active");
    activeCall.mockReturnValue({ data: call });
    linkMutate.mockClear();
  });

  it("names who is on the line and offers to link the call", async () => {
    const user = userEvent.setup();
    render(<LiveCallStrip dealId="d1" />);

    expect(screen.getByText(/Jane Roe/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /link this call/i }));

    expect(linkMutate).toHaveBeenCalledWith({ sid: "CA1", dealId: "d1" });
  });

  it("says so instead when the call is already on this job", () => {
    activeCall.mockReturnValue({ data: { ...call, dealId: "d1" } });
    render(<LiveCallStrip dealId="d1" />);

    expect(screen.getByText(/linked to this job/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /link this call/i }),
    ).not.toBeInTheDocument();
  });

  it("offers to move a call that is linked to a different job", () => {
    activeCall.mockReturnValue({ data: { ...call, dealId: "other" } });
    render(<LiveCallStrip dealId="d1" />);

    expect(
      screen.getByRole("button", { name: /link to this job instead/i }),
    ).toBeInTheDocument();
  });

  it("shows nothing when no call is in progress", () => {
    activeCall.mockReturnValue({ data: null });
    const { container } = render(<LiveCallStrip dealId="d1" />);

    // The whole point is that it only exists during a call.
    expect(container).toBeEmptyDOMElement();
  });

  it("appears in a tab that doesn't hold the audio, and says so", async () => {
    // The job opened in a second tab is the normal way to use this: the call
    // is in tab one, the work is here. This tab has no call of its own.
    callState.mockReturnValue("idle");
    const user = userEvent.setup();
    render(<LiveCallStrip dealId="d1" />);

    expect(screen.getByText(/Jane Roe/)).toBeInTheDocument();
    expect(screen.getByText(/audio is in another tab/i)).toBeInTheDocument();

    // And linking still works from here — it never needed the audio.
    await user.click(screen.getByRole("button", { name: /link this call/i }));
    expect(linkMutate).toHaveBeenCalledWith({ sid: "CA1", dealId: "d1" });
  });

  it("shows nothing while the call record hasn't resolved yet", () => {
    activeCall.mockReturnValue({ data: null });
    const { container } = render(<LiveCallStrip dealId="d1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
