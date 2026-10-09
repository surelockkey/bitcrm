import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "../lib";
import { BlockCallerButton } from "./block-caller-button";

const mocks = vi.hoisted(() => ({
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("@/features/telephony/components/block-number-dialog", () => ({
  BlockNumberDialog: ({ open, initialNumber }: { open: boolean; initialNumber?: string }) =>
    open ? <div data-testid="block-dialog">{initialNumber}</div> : null,
}));

const call = (patch: Partial<CallRecord> = {}): CallRecord => ({
  callSid: "CA1",
  direction: "inbound",
  from: "+12147917112",
  to: "+14045550100",
  status: "completed",
  startedAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:05:00.000Z",
  ...patch,
});

/**
 * "Block this number" on a call (its side panel and its page): opens Workiz's
 * "Block a Number" form with the other side's number filled in. Only for a
 * viewer with `calls.block`, and only for an outside number.
 */
describe("BlockCallerButton", () => {
  beforeEach(() => mocks.can.mockReturnValue(true));

  it("opens the form on the caller's number", async () => {
    render(<BlockCallerButton call={call()} />);
    await userEvent.click(screen.getByRole("button", { name: "Block this number" }));
    expect(screen.getByTestId("block-dialog")).toHaveTextContent("+12147917112");
  });

  it("is the client's number on an outgoing call", async () => {
    render(<BlockCallerButton call={call({ direction: "outbound", from: "+14045550100", to: "+12147917112" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Block this number" }));
    expect(screen.getByTestId("block-dialog")).toHaveTextContent("+12147917112");
  });

  it("is not offered without calls.block", () => {
    mocks.can.mockImplementation((_r: string, action?: string) => action !== "block");
    render(<BlockCallerButton call={call()} />);
    expect(screen.queryByRole("button", { name: "Block this number" })).not.toBeInTheDocument();
  });

  it("is not offered for a withheld number or our own leg", () => {
    render(<BlockCallerButton call={call({ from: undefined, fromMasked: true })} />);
    expect(screen.queryByRole("button", { name: "Block this number" })).not.toBeInTheDocument();
    render(<BlockCallerButton call={call({ from: "client:agent-1", fromParty: { kind: "user", id: "u1", name: "Sam" } })} />);
    expect(screen.queryByRole("button", { name: "Block this number" })).not.toBeInTheDocument();
  });
});
