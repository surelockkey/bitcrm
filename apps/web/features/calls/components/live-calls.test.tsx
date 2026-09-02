import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CallRecord } from "../lib";
import { LiveCalls } from "./live-calls";

const liveCalls = vi.fn<() => { data: CallRecord[] }>();

vi.mock("../hooks", () => ({ useLiveCalls: () => liveCalls() }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => false }), // no join rights: no monitor buttons
}));
vi.mock("@/features/telephony/softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) =>
    sel({ status: "offline", callState: "idle" }),
}));
vi.mock("@/features/telephony/use-call-timer", () => ({
  useCallTimer: () => "0:12",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const base = {
  callSid: "CA1",
  status: "in-progress" as const,
  direction: "inbound" as const,
  from: "+14045551234",
  to: "+15412830739",
  startedAt: "2026-08-11T10:00:00.000Z",
  updatedAt: "2026-08-11T10:00:00.000Z",
  answeredAt: "2026-08-11T10:00:05.000Z",
};

describe("LiveCalls", () => {
  it("leads with the client's name and keeps their number beneath", () => {
    liveCalls.mockReturnValue({
      data: [{ ...base, fromParty: { kind: "contact" as const, id: "c1", name: "Jane Roe" } }],
    });
    render(<LiveCalls />);

    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    expect(screen.getByText(/\(404\) 555-1234/)).toBeInTheDocument();
  });

  it("falls back to the number for a caller the CRM doesn't know", () => {
    liveCalls.mockReturnValue({ data: [base] });
    render(<LiveCalls />);

    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(screen.getByText(/Incoming/)).toBeInTheDocument();
  });

  it("names the client on outbound calls too", () => {
    liveCalls.mockReturnValue({
      data: [
        {
          ...base,
          direction: "outbound",
          from: "+15412830739",
          to: "+14045551234",
          fromParty: { kind: "user" as const, id: "u1", name: "Nazarii" },
          toParty: { kind: "contact" as const, id: "c1", name: "Jane Roe" },
          participants: [
            { userId: "u1", role: "caller" as const, at: "", name: "Nazarii" },
          ],
        },
      ],
    });
    render(<LiveCalls />);

    // The client leads; the agent who dialled stays on the detail line.
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    expect(screen.getByText(/Outgoing.*Nazarii/)).toBeInTheDocument();
  });

  it("still leads with the people talking on an internal call", () => {
    liveCalls.mockReturnValue({
      data: [
        {
          ...base,
          direction: "outbound",
          fromParty: { kind: "user" as const, id: "u1", name: "Nazarii" },
          toParty: { kind: "user" as const, id: "u2", name: "Tamir" },
          participants: [
            { userId: "u1", role: "caller" as const, at: "", name: "Nazarii" },
            { userId: "u2", role: "answered" as const, at: "", name: "Tamir" },
          ],
        },
      ],
    });
    render(<LiveCalls />);

    expect(screen.getByText("Nazarii → Tamir")).toBeInTheDocument();
    expect(screen.getByText(/Internal/)).toBeInTheDocument();
  });

  it("renders nothing when no call is live", () => {
    liveCalls.mockReturnValue({ data: [] });
    const { container } = render(<LiveCalls />);
    expect(container).toBeEmptyDOMElement();
  });
});
