import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "../lib";
import { CallsTable } from "./calls-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

// The dialog pulls in the react-query client; it's closed in every test here.
vi.mock("./new-client-from-call-dialog", () => ({
  NewClientFromCallDialog: () => null,
}));

// Party cells resolve names through react-query; irrelevant to the preview.
vi.mock("./call-party-cell", () => ({
  CallPartyCell: () => <span>party</span>,
}));

// The quick view fetches the call detail; serve it from the fixture list.
const detail = vi.fn<(sid: string) => CallRecord | undefined>();
vi.mock("../hooks", () => ({
  useCallDetail: (sid: string) => ({ data: detail(sid), isLoading: false }),
}));

// Associations pull jobs through react-query; not under test here.
vi.mock("./call-associations", () => ({
  CallAssociations: () => <div>associations</div>,
}));
vi.mock("@/features/job-sources/lib", () => ({
  useJobSourceName: () => () => "—",
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
    startedAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:05:00.000Z",
    durationSeconds: 65,
    ...over,
  }) as CallRecord;

beforeEach(() => {
  push.mockClear();
  fetchRecordingBlob.mockReset();
  fetchRecordingBlob.mockResolvedValue(new Blob(["audio"]));
  // jsdom lacks object URLs.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:recording");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // @ts-expect-error test stub cleanup
  delete globalThis.URL.createObjectURL;
  // @ts-expect-error test stub cleanup
  delete globalThis.URL.revokeObjectURL;
});

describe("CallsTable recording preview", () => {
  it("offers a play button only for calls that have a recording", () => {
    render(
      <CallsTable
        calls={[
          call({ callSid: "CA1", recordingSid: "RE1" }),
          call({ callSid: "CA2" }),
        ]}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /play recording/i }),
    ).toHaveLength(1);
  });

  it("plays the recording inline instead of navigating", async () => {
    const user = userEvent.setup();
    render(<CallsTable calls={[call({ callSid: "CA1", recordingSid: "RE1" })]} />);

    await user.click(screen.getByRole("button", { name: /play recording/i }));

    const audio = await screen.findByTestId("recording-audio");
    expect(audio).toHaveAttribute("src", "blob:recording");
    expect(fetchRecordingBlob).toHaveBeenCalledWith("CA1");
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the player from the same control", async () => {
    const user = userEvent.setup();
    render(<CallsTable calls={[call({ callSid: "CA1", recordingSid: "RE1" })]} />);

    await user.click(screen.getByRole("button", { name: /play recording/i }));
    await screen.findByTestId("recording-audio");

    await user.click(screen.getByRole("button", { name: /close player/i }));
    expect(screen.queryByTestId("recording-audio")).not.toBeInTheDocument();
  });

  it("keeps a single player: starting another call's preview moves it", async () => {
    const user = userEvent.setup();
    render(
      <CallsTable
        calls={[
          call({ callSid: "CA1", recordingSid: "RE1" }),
          call({ callSid: "CA2", recordingSid: "RE2" }),
        ]}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /play recording/i });
    await user.click(buttons[0]);
    await screen.findByTestId("recording-audio");

    await user.click(screen.getAllByRole("button", { name: /play recording/i })[0]);
    const audios = await screen.findAllByTestId("recording-audio");
    expect(audios).toHaveLength(1);
    expect(fetchRecordingBlob).toHaveBeenLastCalledWith("CA2");
  });

  it("opens the side preview from the row instead of navigating", async () => {
    const user = userEvent.setup();
    const rec = call({ callSid: "CA1", recordingSid: "RE1" });
    detail.mockReturnValue(rec);
    render(<CallsTable calls={[rec]} />);

    await user.click(screen.getByText("Completed"));

    expect(push).not.toHaveBeenCalled();
    const panel = await screen.findByRole("dialog");
    const open = within(panel).getByRole("link", { name: /open full call/i });
    expect(open).toHaveAttribute("href", "/calls/CA1");
  });

  it("closes the side preview", async () => {
    const user = userEvent.setup();
    const rec = call({ callSid: "CA1" });
    detail.mockReturnValue(rec);
    render(<CallsTable calls={[rec]} />);

    await user.click(screen.getByText("Completed"));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
