"use client";

import { useState } from "react";
import { CallTagCombobox } from "@/features/call-tags/components/call-tag-combobox";
import { usePermissions } from "@/features/auth/use-permissions";
import { useSetCallTags } from "../hooks";
import type { CallRecord } from "../lib";

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The tags on one call, ready to edit — the Workiz "Tags" column. Turns the
 * picker's "here is the whole list now" into the add/remove delta the API
 * takes, and shows the new chips immediately rather than after the round trip
 * (a dispatcher marking a queue of spam calls clicks far faster than a
 * refetch).
 *
 * The catalog itself sits behind `settings.view`; a viewer without it gets
 * read-only chips rather than a request that is certain to 403.
 */
export function CallTagsCell({
  call,
  /** Inside a clickable table row — keep clicks off the row. */
  inRow,
  className,
}: {
  call: Pick<CallRecord, "callSid" | "tagIds">;
  inRow?: boolean;
  className?: string;
}) {
  const { can } = usePermissions();
  const setTags = useSetCallTags();
  const stored = call.tagIds ?? [];
  // What the picker shows while the write is in flight, remembered together
  // with the list it was computed from. Once the refreshed record arrives the
  // `from` no longer matches and the draft falls away on its own — no effect
  // to clear it, and the server stays the source of truth.
  const [draft, setDraft] = useState<{ from: string[]; next: string[] } | null>(
    null,
  );

  const canRead = can("settings");
  // Tagging a call is a call-log action, like linking one to a job.
  const canTag = can("calls") && canRead;
  const value = draft && sameList(draft.from, stored) ? draft.next : stored;

  const apply = (next: string[]) => {
    const add = next.filter((id) => !value.includes(id));
    const remove = value.filter((id) => !next.includes(id));
    if (!add.length && !remove.length) return;
    setDraft({ from: stored, next });
    setTags.mutate(
      { sid: call.callSid, add, remove },
      // A rejected change (unknown or archived tag, cap reached) must not
      // leave the chip on screen — the toast explains, the chips revert.
      { onError: () => setDraft(null) },
    );
  };

  return (
    <CallTagCombobox
      value={value}
      onChange={apply}
      disabled={!canTag}
      catalogEnabled={canRead}
      stopPropagation={inRow}
      className={className}
    />
  );
}
