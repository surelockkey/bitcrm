import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SoftphoneWidget } from "./softphone-widget";
import { useSoftphoneStore } from "../softphone-store";

/**
 * The dialer lets the user pick which microphone a call uses and tells them
 * when the one in use sends only silence — the two things that were missing
 * when Chrome quietly handed the softphone an iPhone's microphone.
 */

const mocks = vi.hoisted(() => ({
  selectInputDevice: vi.fn(async () => {}),
}));

vi.mock("../softphone-manager", () => ({
  acceptIncoming: vi.fn(),
  hangup: vi.fn(),
  rejectIncoming: vi.fn(),
  sendDigit: vi.fn(),
  startCall: vi.fn(),
  toggleMute: vi.fn(),
  takeCallHere: vi.fn(),
  selectInputDevice: mocks.selectInputDevice,
}));
vi.mock("@/features/calls/hooks", () => ({
  useActiveCall: () => ({ data: undefined }),
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

const MICS = [
  { deviceId: "mic-iphone", label: "iPhone Microphone" },
  { deviceId: "mic-mac", label: "MacBook Pro Microphone" },
];

function openDialer(over: Partial<ReturnType<typeof useSoftphoneStore.getState>> = {}) {
  useSoftphoneStore.setState({
    dialerOpen: true,
    phoneOn: true,
    status: "online",
    errorMessage: null,
    callState: "idle",
    call: null,
    muted: false,
    inputDevices: MICS,
    inputDeviceId: null,
    micWarning: null,
    ...over,
  });
}

describe("SoftphoneWidget — microphone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the microphones by name, the browser's choice first", () => {
    openDialer();
    render(<SoftphoneWidget />);
    const picker = screen.getByRole("combobox", { name: "Microphone" });
    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Default microphone", "iPhone Microphone", "MacBook Pro Microphone"]);
    expect(picker).toHaveValue("");
  });

  it("shows the microphone the user picked and switches on change", () => {
    openDialer({ inputDeviceId: "mic-mac" });
    render(<SoftphoneWidget />);
    const picker = screen.getByRole("combobox", { name: "Microphone" });
    expect(picker).toHaveValue("mic-mac");

    fireEvent.change(picker, { target: { value: "mic-iphone" } });
    expect(mocks.selectInputDevice).toHaveBeenCalledWith("mic-iphone");

    fireEvent.change(picker, { target: { value: "" } });
    expect(mocks.selectInputDevice).toHaveBeenCalledWith(null);
  });

  it("stays out of the way when there is nothing to choose between", () => {
    openDialer({ inputDevices: [MICS[1]] });
    render(<SoftphoneWidget />);
    expect(screen.queryByRole("combobox", { name: "Microphone" })).toBeNull();
  });

  it("keeps the picker during a call, so a silent microphone can be swapped without hanging up", () => {
    openDialer({
      callState: "active",
      call: { direction: "outbound", number: "+12125550123", startedAt: 1 },
      micWarning: "No sound from your microphone — pick another one.",
    });
    render(<SoftphoneWidget />);
    expect(screen.getByText("No sound from your microphone — pick another one.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Microphone" })).toBeInTheDocument();
  });

  it("shows the picker alone with one microphone when that one is silent", () => {
    openDialer({
      inputDevices: [MICS[1]],
      callState: "active",
      call: { direction: "outbound", number: "+12125550123", startedAt: 1 },
      micWarning: "No sound from your microphone — pick another one.",
    });
    render(<SoftphoneWidget />);
    expect(screen.getByRole("combobox", { name: "Microphone" })).toBeInTheDocument();
  });
});
