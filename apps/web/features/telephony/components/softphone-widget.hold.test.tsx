import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SoftphoneWidget } from "./softphone-widget";
import { useSoftphoneStore } from "../softphone-store";

/**
 * Hold sits next to Mute and works like it: one press holds the customer
 * (they hear the company's hold music), another resumes. It needs the call
 * record the server resolves, so it waits for that like Add and Transfer.
 */

const mocks = vi.hoisted(() => ({
  toggleHold: vi.fn(async () => {}),
  activeCall: { data: undefined as Record<string, unknown> | undefined },
}));

vi.mock("../softphone-manager", () => ({
  acceptIncoming: vi.fn(),
  hangup: vi.fn(),
  rejectIncoming: vi.fn(),
  sendDigit: vi.fn(),
  startCall: vi.fn(),
  toggleMute: vi.fn(),
  toggleHold: mocks.toggleHold,
  takeCallHere: vi.fn(),
  selectInputDevice: vi.fn(),
}));
vi.mock("@/features/calls/hooks", () => ({
  useActiveCall: () => mocks.activeCall,
}));
vi.mock("../numbers-hooks", () => ({ useNumbers: () => ({ data: [] }) }));
vi.mock("../tab-coordinator", () => ({ onMessage: () => () => {} }));
vi.mock("../use-call-timer", () => ({ useCallTimer: () => "00:05" }));
vi.mock("./dialer-directory", () => ({ DialerDirectory: () => null }));
vi.mock("./transfer-panel", () => ({ TransferPanel: () => null }));
vi.mock("@/features/calls/components/call-job-actions", () => ({
  CallJobActions: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const LIVE = { callSid: "CA1", status: "in-progress", startedAt: "", updatedAt: "" };

function onCall(over: Partial<ReturnType<typeof useSoftphoneStore.getState>> = {}) {
  useSoftphoneStore.setState({
    dialerOpen: true,
    phoneOn: true,
    status: "online",
    errorMessage: null,
    callState: "active",
    call: { direction: "outbound", number: "+12125550123", startedAt: 1 },
    muted: false,
    held: false,
    inputDevices: [],
    inputDeviceId: null,
    micWarning: null,
    ...over,
  });
}

describe("SoftphoneWidget — hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeCall = { data: LIVE };
  });

  it("holds the call the server knows about", () => {
    onCall();
    render(<SoftphoneWidget />);
    fireEvent.click(screen.getByRole("button", { name: /^hold$/i }));
    expect(mocks.toggleHold).toHaveBeenCalledWith("CA1");
  });

  it("waits for the call record before it can hold", () => {
    mocks.activeCall = { data: undefined };
    onCall();
    render(<SoftphoneWidget />);
    expect(screen.getByRole("button", { name: /^hold$/i })).toBeDisabled();
  });

  it("cannot hold a call that is still ringing", () => {
    onCall({ callState: "connecting" });
    render(<SoftphoneWidget />);
    expect(screen.queryByRole("button", { name: /^hold$/i })?.hasAttribute("disabled") ?? true).toBe(true);
  });

  it("offers Resume and says the customer is on hold while held", () => {
    mocks.activeCall = { data: { ...LIVE, onHold: true } };
    onCall({ held: true });
    render(<SoftphoneWidget />);
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeEnabled();
    expect(screen.getByText(/on hold/i)).toBeInTheDocument();
  });

  it("does not say On hold when the call is not held", () => {
    onCall();
    render(<SoftphoneWidget />);
    expect(screen.queryByText(/on hold/i)).not.toBeInTheDocument();
  });

  it("shows a hold placed from another tab", () => {
    mocks.activeCall = { data: { ...LIVE, onHold: true } };
    onCall();
    render(<SoftphoneWidget />);
    expect(useSoftphoneStore.getState().held).toBe(true);
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeInTheDocument();
  });
});
