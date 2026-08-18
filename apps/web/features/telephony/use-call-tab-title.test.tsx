import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CallRecord } from "@/features/calls/lib";
import { useCallTabTitle } from "./use-call-tab-title";

const mocks = vi.hoisted(() => ({
  callState: "idle" as string,
  call: null as CallRecord | null,
}));

vi.mock("./softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) =>
    sel({ callState: mocks.callState }),
}));
vi.mock("@/features/calls/hooks", () => ({
  useActiveCall: () => ({ data: mocks.call }),
}));

const call = (over: Partial<CallRecord> = {}): CallRecord =>
  ({
    callSid: "CA1",
    direction: "inbound",
    from: "+14045551234",
    to: "+15412830739",
    status: "in-progress",
    startedAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
    fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
    ...over,
  }) as CallRecord;

function Probe() {
  useCallTabTitle();
  return null;
}

describe("useCallTabTitle", () => {
  beforeEach(() => {
    mocks.callState = "idle";
    mocks.call = null;
    document.title = "BitCRM";
  });

  it("names who you're on the call with", () => {
    mocks.call = call();
    render(<Probe />);
    expect(document.title).toBe("Call with Jane Roe · BitCRM");
  });

  it("falls back to the number when the caller isn't a known client", () => {
    mocks.call = call({ fromParty: undefined });
    render(<Probe />);
    expect(document.title).toMatch(/Call with .*404.*555.*1234 · BitCRM/);
  });

  it("says a call is coming in, in the tab that is ringing", () => {
    mocks.callState = "incoming";
    mocks.call = call({ status: "ringing" });
    render(<Probe />);
    expect(document.title).toBe("Incoming — Jane Roe · BitCRM");
  });

  it("leaves the title alone when there is no call", () => {
    render(<Probe />);
    expect(document.title).toBe("BitCRM");
  });

  it("ignores a call that has already ended", () => {
    mocks.call = call({ status: "completed" });
    render(<Probe />);
    expect(document.title).toBe("BitCRM");
  });

  it("gives the title back when the call ends", () => {
    mocks.call = call();
    const { rerender } = render(<Probe />);
    expect(document.title).toBe("Call with Jane Roe · BitCRM");

    mocks.call = null;
    rerender(<Probe />);
    expect(document.title).toBe("BitCRM");
  });

  it("wins over a navigation that retitles the page mid-call", async () => {
    mocks.call = call();
    render(<Probe />);

    // What Next does on a route change.
    document.title = "Jobs · BitCRM";
    await new Promise((r) => setTimeout(r, 0));

    expect(document.title).toBe("Call with Jane Roe · BitCRM");

    // …and the page the user navigated to is what they get back afterwards.
    cleanup();
    expect(document.title).toBe("Jobs · BitCRM");
  });
});
