import { describe, expect, it } from "vitest";
import { callStatusIcon } from "./call-status-icon";
import type { CallRecord } from "./lib";

/**
 * Workiz's Status column (callspage_wz_*: the `callIcon-*` glyph and its
 * tooltip): a call still going, answered or missed incoming, answered or
 * unanswered outgoing. Answered is the call-tracking report's rule — picked
 * up (`answeredAt`) or completed — so the icons agree with MISSED CALLS.
 */
const call = (patch: Partial<CallRecord>): CallRecord => ({
  callSid: "CA1",
  startedAt: "2026-10-08T19:00:00.000Z",
  updatedAt: "2026-10-08T19:01:00.000Z",
  ...patch,
});

describe("callStatusIcon", () => {
  it.each(["queued", "initiated", "ringing", "in-progress"] as const)("a %s call is an Active call", (status) => {
    expect(callStatusIcon(call({ direction: "inbound", status }))).toEqual({ kind: "active", tooltip: "Active call" });
  });

  it("an incoming call somebody picked up is an Incoming call", () => {
    expect(callStatusIcon(call({ direction: "inbound", status: "completed", answeredAt: "x" }))).toEqual({
      kind: "in-answered",
      tooltip: "Incoming call",
    });
    expect(callStatusIcon(call({ direction: "inbound", status: "completed" })).kind).toBe("in-answered");
  });

  it.each(["no-answer", "busy", "canceled", "failed"] as const)("an incoming %s call is a Missed call", (status) => {
    expect(callStatusIcon(call({ direction: "inbound", status }))).toEqual({ kind: "in-missed", tooltip: "Missed call" });
  });

  it("an outgoing call that connected is an Outgoing call", () => {
    expect(callStatusIcon(call({ direction: "outbound", status: "completed" }))).toEqual({
      kind: "out-answered",
      tooltip: "Outgoing call",
    });
  });

  it.each(["no-answer", "busy", "canceled", "failed"] as const)("an outgoing %s call reads No answer", (status) => {
    expect(callStatusIcon(call({ direction: "outbound", status }))).toEqual({ kind: "out-unanswered", tooltip: "No answer" });
  });

  it("an incoming call from a blocked number is a Blocked caller, not a Missed call", () => {
    expect(callStatusIcon(call({ direction: "inbound", status: "blocked" }))).toEqual({
      kind: "in-blocked",
      tooltip: "Blocked caller",
    });
  });

  it("a call with no direction on record is drawn as outgoing", () => {
    expect(callStatusIcon(call({ status: "completed" })).kind).toBe("out-answered");
  });
});
