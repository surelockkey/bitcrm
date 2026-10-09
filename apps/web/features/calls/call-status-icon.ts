import { isLive, type CallRecord } from "./lib";

/**
 * The glyph in Workiz's Status column and its tooltip (`callIcon-*`,
 * `data-ai-tooltip`). "Answered" is the call-tracking report's rule for our
 * own calls — somebody picked up, or the call completed — and imported calls
 * arrive with Workiz's answer already folded into `status` (a missed one is
 * `no-answer`), so the icons agree with the MISSED CALLS card.
 *
 * `in-blocked` is ours: an inbound call turned away because its number is on
 * the Blocked callers list. Workiz hides those calls; we show them, but not
 * as a miss — nobody was meant to answer.
 */
export type CallIconKind = "active" | "in-answered" | "in-missed" | "in-blocked" | "out-answered" | "out-unanswered";

const TOOLTIP: Record<CallIconKind, string> = {
  active: "Active call",
  "in-answered": "Incoming call",
  "in-missed": "Missed call",
  "in-blocked": "Blocked caller",
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
        : call.status === "blocked"
          ? "in-blocked"
          : "in-missed"
      : answered
        ? "out-answered"
        : "out-unanswered";
  return { kind, tooltip: TOOLTIP[kind] };
}
