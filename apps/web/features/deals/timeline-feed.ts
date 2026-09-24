import type { TimelineEntry } from "@bitcrm/types";
import type { CallRecord } from "@/features/calls/lib";
import type { FeedMessage } from "@/features/messaging/api";

/**
 * A job's history as one story: what was done to the job, who called, who
 * wrote.
 *
 * The calls and the messages live in telephony and messaging, so the activity
 * panel used to show neither — a dispatcher read that the job had been edited
 * and assigned, with no sign that anyone had ever phoned or written about it.
 *
 * They are merged here, at read time, rather than copied into the timeline:
 * both are already indexed by job, and a million imported calls have no
 * business being written a second time.
 */
export type FeedRow =
  | { kind: "entry"; id: string; at: string; entry: TimelineEntry }
  | { kind: "call"; id: string; at: string; call: CallRecord }
  | { kind: "message"; id: string; at: string; message: FeedMessage };

export function mergeTimelineFeed({
  dealId,
  entries,
  calls,
  messages,
}: {
  dealId: string;
  entries: TimelineEntry[];
  calls: CallRecord[];
  messages: FeedMessage[];
}): FeedRow[] {
  const rows: FeedRow[] = [
    ...entries.map((entry): FeedRow => ({ kind: "entry", id: entry.id, at: entry.timestamp, entry })),
    // A call reaches a client, not a job; only the ones actually attached to
    // this job belong in its story.
    ...calls
      .filter((c) => c.dealId === dealId)
      // The id is prefixed because a call sid and an entry id share no
      // namespace, and React needs keys that cannot collide.
      .map((call): FeedRow => ({ kind: "call", id: `call:${call.callSid}`, at: call.startedAt ?? "", call })),
    ...messages.map((message): FeedRow => ({
      kind: "message",
      id: `message:${message.id}`,
      at: message.createdAt ?? "",
      message,
    })),
  ];

  // Newest first. A row with no time on it is still a row — it sinks to the
  // bottom rather than taking the feed down with it.
  return rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
