import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "@/features/calls/lib";
import { CallClientButton } from "./call-client-button";

const mocks = vi.hoisted(() => ({
  startCall: vi.fn(),
  setActiveNumber: vi.fn(),
  status: "online" as string,
}));

vi.mock("../softphone-manager", () => ({ startCall: mocks.startCall }));
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
    mocks.setActiveNumber.mockClear();
    mocks.status = "online";
  });

  it("stays out of the way until it's clicked", () => {
    render(<CallClientButton to="+14045551234" partyId="c1" />);
    expect(screen.queryByText(/from which of our numbers/i)).not.toBeInTheDocument();
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
