import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useCallTabTitle } from "./use-call-tab-title";

const state = vi.hoisted(() => ({
  callState: "idle" as string,
  call: null as { number: string; contactName?: string } | null,
}));

vi.mock("./softphone-store", () => ({
  useSoftphoneStore: (sel: (s: unknown) => unknown) => sel(state),
}));

function Probe() {
  useCallTabTitle();
  return null;
}

describe("useCallTabTitle", () => {
  beforeEach(() => {
    state.callState = "idle";
    state.call = null;
    document.title = "BitCRM";
  });

  it("names who this tab is on the call with", () => {
    state.callState = "active";
    state.call = { number: "+14045551234", contactName: "Jane Roe" };
    render(<Probe />);
    expect(document.title).toBe("Call with Jane Roe · BitCRM");
  });

  it("falls back to the number when the caller isn't a known client", () => {
    state.callState = "active";
    state.call = { number: "+14045551234" };
    render(<Probe />);
    expect(document.title).toMatch(/Call with .*404.*555.*1234 · BitCRM/);
  });

  it("says a call is coming in, while it rings", () => {
    state.callState = "incoming";
    state.call = { number: "+14045551234", contactName: "Jane Roe" };
    render(<Probe />);
    expect(document.title).toBe("Incoming — Jane Roe · BitCRM");
  });

  it("labels the tab while the call is still connecting", () => {
    state.callState = "connecting";
    state.call = { number: "+14045551234", contactName: "Jane Roe" };
    render(<Probe />);
    expect(document.title).toBe("Call with Jane Roe · BitCRM");
  });

  it("leaves a tab that has no call alone, even during somebody else's", () => {
    // The other tabs know about the call from the server — but the title is
    // how you find the tab with the audio, so only that one is labelled.
    render(<Probe />);
    expect(document.title).toBe("BitCRM");
  });

  it("gives the title back when the call ends", () => {
    state.callState = "active";
    state.call = { number: "+14045551234", contactName: "Jane Roe" };
    const { rerender } = render(<Probe />);
    expect(document.title).toBe("Call with Jane Roe · BitCRM");

    state.callState = "idle";
    state.call = null;
    rerender(<Probe />);
    expect(document.title).toBe("BitCRM");
  });

  it("wins over a navigation that retitles the page mid-call", async () => {
    state.callState = "active";
    state.call = { number: "+14045551234", contactName: "Jane Roe" };
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
