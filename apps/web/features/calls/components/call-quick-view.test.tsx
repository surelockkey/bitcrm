import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CallRecord } from "../lib";
import { CallQuickView } from "./call-quick-view";

const detail = vi.fn<() => { data?: CallRecord; isLoading: boolean }>();
vi.mock("../hooks", () => ({ useCallDetail: () => detail() }));

vi.mock("./call-associations", () => ({
  CallAssociations: () => <div>associations</div>,
}));
vi.mock("./call-party-cell", () => ({
  CallPartyCell: () => <span>party</span>,
}));

const fetchRecordingBlob = vi.fn<(sid: string) => Promise<Blob>>();
vi.mock("../api", () => ({
  fetchRecordingBlob: (sid: string) => fetchRecordingBlob(sid),
}));

const call = (over: Partial<CallRecord>): CallRecord =>
  ({
    callSid: "CA1",
    status: "completed",
    direction: "inbound",
    from: "+14045551234",
    to: "+15412830739",
    startedAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-08-31T10:05:00.000Z",
    durationSeconds: 65,
    ...over,
  }) as CallRecord;

beforeEach(() => {
  fetchRecordingBlob.mockReset();
  fetchRecordingBlob.mockResolvedValue(new Blob(["audio"]));
  globalThis.URL.createObjectURL = vi.fn(() => "blob:recording");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // @ts-expect-error test stub cleanup
  delete globalThis.URL.createObjectURL;
  // @ts-expect-error test stub cleanup
  delete globalThis.URL.revokeObjectURL;
});

describe("CallQuickView", () => {
  it("shows the caller, status and call facts", () => {
    detail.mockReturnValue({
      data: call({ recordingSid: "RE1" }),
      isLoading: false,
    });
    render(<CallQuickView callSid="CA1" open onOpenChange={() => {}} />);

    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(screen.getByText(/incoming call/i)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("associations")).toBeInTheDocument();
  });

  it("plays the recording inside the panel", async () => {
    detail.mockReturnValue({
      data: call({ recordingSid: "RE1" }),
      isLoading: false,
    });
    render(<CallQuickView callSid="CA1" open onOpenChange={() => {}} />);

    expect(await screen.findByTestId("recording-audio")).toHaveAttribute(
      "src",
      "blob:recording",
    );
  });

  it("says when there is no recording", () => {
    detail.mockReturnValue({ data: call({}), isLoading: false });
    render(<CallQuickView callSid="CA1" open onOpenChange={() => {}} />);

    expect(screen.getByText(/no recording/i)).toBeInTheDocument();
    expect(fetchRecordingBlob).not.toHaveBeenCalled();
  });

  it("links to the full call page", () => {
    detail.mockReturnValue({ data: call({}), isLoading: false });
    render(<CallQuickView callSid="CA1" open onOpenChange={() => {}} />);

    expect(
      screen.getByRole("link", { name: /open full call/i }),
    ).toHaveAttribute("href", "/calls/CA1");
  });
});
