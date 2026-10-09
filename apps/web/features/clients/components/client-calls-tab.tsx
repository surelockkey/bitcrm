"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { formatPhone } from "@/lib/phone";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useCallsForParty } from "@/features/calls/hooks";
import { callParty, type CallRecord } from "@/features/calls/lib";
import { workizDateTime } from "@/features/deals/schedule-cell";
import { openRow } from "./client-jobs-tab";

/** A side of the call as Workiz's From / To cell: the name over the number. */
function Party({ call, side }: { call: CallRecord; side: "from" | "to" }) {
  const p = callParty(call, side);
  const name = p.name;
  const number = p.masked ? "Number hidden" : p.number ? formatPhone(p.number) : "";
  return (
    <>
      {name ? <div className="truncate">{name}</div> : null}
      <div className={name ? "mt-4 truncate" : "truncate"}>{number}</div>
    </>
  );
}

/**
 * Workiz's Calls tab (pg_contact_wz_269669_tab_calls): From | To | Time | Call
 * Flow | Duration (seconds), newest first; each side the name over the
 * number. The calls are paged by the API; the tab walks them all so the grid
 * can count and page like the other tabs. A row opens the call.
 */
export function ClientCallsTab({ contactId }: { contactId: string }) {
  const router = useRouter();
  const query = useCallsForParty("contact", contactId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const calls = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const columns = useMemo<WzGridColumn<CallRecord>[]>(() => {
    const side = (c: CallRecord, s: "from" | "to") => {
      const p = callParty(c, s);
      return `${p.name ?? ""} ${p.number ?? ""}`;
    };
    const time = (c: CallRecord) => workizDateTime(c.startedAt, DEFAULT_TZ);
    return [
      { id: "from", label: "From", sortValue: (c) => side(c, "from"), searchText: (c) => side(c, "from"), render: (c) => <Party call={c} side="from" /> },
      { id: "to", label: "To", sortValue: (c) => side(c, "to"), searchText: (c) => side(c, "to"), render: (c) => <Party call={c} side="to" /> },
      { id: "time", label: "Time", sortValue: (c) => c.startedAt, searchText: time, render: time },
      { id: "flow", label: "Call Flow", sortValue: (c) => c.flowName, searchText: (c) => c.flowName, render: (c) => c.flowName ?? "" },
      { id: "duration", label: "Duration", sortValue: (c) => c.durationSeconds ?? 0, render: (c) => String(Math.max(0, Math.floor(c.durationSeconds ?? 0))) },
    ];
  }, []);

  return (
    <WzLocalGrid
      label="Calls"
      searchLabel="Search calls"
      columns={columns}
      rows={calls}
      rowKey={(c) => c.callSid}
      defaultSort={{ id: "time", dir: "desc" }}
      onRowClick={(c, e) => openRow(router, `/calls/${c.callSid}`, e)}
      footer={query.isLoading ? <p className="px-2.5 pt-2 text-xs text-wz-outline-label">Loading the client&apos;s calls…</p> : null}
    />
  );
}
