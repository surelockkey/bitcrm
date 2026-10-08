import { isLive, type CallRecord } from "./lib";

/**
 * The glyph in Workiz's Status column and its tooltip (`callIcon-*`,
 * `data-ai-tooltip`). "Answered" is the call-tracking report's rule for our
 * own calls — somebody picked up, or the call completed — and imported calls
 * arrive with Workiz's answer already folded into `status` (a missed one is
 * `no-answer`), so the icons agree with the MISSED CALLS card.
 */
export type CallIconKind = "active" | "in-answered" | "in-missed" | "out-answered" | "out-unanswered";

const TOOLTIP: Record<CallIconKind, string> = {
  active: "Active call",
  "in-answered": "Incoming call",
  "in-missed": "Missed call",
  "out-answered": "Outgoing call",
  "out-unanswered": "No answer",
};

export function callStatusIcon(
  call: Pick<CallRecord, "direction" | "status" | "answeredAt">,
): { kind: CallIconKind; tooltip: string } {
  const answered = !!call.answeredAt || call.status === "completed";
  const kind: CallIconKind = isLive(call)
    ? "active"
    : call.direction === "inbound"
      ? answered
        ? "in-answered"
        : "in-missed"
      : answered
        ? "out-answered"
        : "out-unanswered";
  return { kind, tooltip: TOOLTIP[kind] };
}
