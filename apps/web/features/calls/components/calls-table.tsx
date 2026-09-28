"use client";

import { Fragment, useState , useMemo } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneIncoming, PhoneOutgoing, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDealsByIds } from "@/features/deals/hooks";
import { useJobSourceName } from "@/features/job-sources/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import {
  answeredBy,
  callParty,
  formatCallTime,
  formatDuration,
  type CallRecord,
} from "../lib";
import { CallPartyCell } from "./call-party-cell";
import { CallQuickView } from "./call-quick-view";
import { CallStatusBadge } from "./call-status-badge";
import { CallTagsCell } from "./call-tags-cell";
import { NewClientFromCallDialog } from "./new-client-from-call-dialog";
import { RecordingPreview } from "./recording-preview";

/**
 * Every column, in order, with the width the table lays it out at.
 *
 * `table-fixed`, on purpose. Several of these columns are filled by their own
 * queries — the answering agent, the call flow, the source, the linked job and
 * its tags — and they land after the rows do. With auto layout the browser
 * re-measures every column as each one arrives, and the whole grid shifts
 * sideways under the reader. Fixed widths make the first painted frame the
 * final geometry; a long value is clipped instead of shoving its neighbours.
 */
const COLUMNS = [
  { key: "expand", label: "", width: 40 },
  { key: "from", label: "From", width: 180 },
  { key: "to", label: "To", width: 180 },
  { key: "status", label: "Status", width: 130 },
  { key: "answeredBy", label: "Answered by", width: 160 },
  { key: "flow", label: "Call flow", width: 200 },
  { key: "source", label: "Source", width: 200 },
  { key: "tags", label: "Tags", width: 160 },
  { key: "jobTags", label: "Job tags", width: 160 },
  { key: "job", label: "Job", width: 90 },
  { key: "started", label: "Started", width: 170 },
  { key: "duration", label: "Duration", width: 100 },
  { key: "rec", label: "Rec", width: 60 },
] as const;

/** Kept in one place so the preview row spans them all. */
const COLUMN_COUNT = COLUMNS.length;

/**
 * The table's shell while the log is still in flight.
 *
 * The same header and the same column widths as the real thing, and rows of
 * the same height — so the first painted frame already has the geometry the
 * calls land into. Three grey bars followed by a full table is a jump the
 * reader watches happen.
 */
export function CallsTableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="overflow-x-auto border" aria-busy role="status" aria-label="Loading calls">
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead key={c.key} className="truncate">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <TableCell key={c.key}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CallsTable({ calls }: { calls: CallRecord[] }) {
  const sourceName = useJobSourceName();
  // One request for every job on the page, not one per row. Each row used to
  // fetch its own (`useDeal(call.dealId)`), so twenty-five calls meant
  // twenty-five requests landing at twenty-five different moments — the Job
  // and Job-tags columns filled in one at a time, which is what the page
  // looked like it was doing.
  const dealIds = useMemo(
    () => [...new Set(calls.map((c) => c.dealId).filter((id): id is string => !!id))],
    [calls],
  );
  const { data: linkedDeals, isLoading: dealsLoading } = useDealsByIds(dealIds);
  const dealsById = useMemo(
    () => new Map((linkedDeals ?? []).map((d) => [d.id, d])),
    [linkedDeals],
  );
  // The number an unknown caller is being turned into a client for.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  // The call whose recording is playing inline; one preview at a time.
  const [previewSid, setPreviewSid] = useState<string | null>(null);
  // The call open in the side preview panel.
  const [quickViewSid, setQuickViewSid] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto border">
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <TableHeader>
          {/* The call's own tags, as in Workiz; the linked job's tags are a
              separate column so neither answer has to stand in for the other. */}
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead
                key={c.key}
                className={c.key === "duration" || c.key === "rec" ? "truncate text-right" : "truncate"}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <Fragment key={call.callSid}>
              <TableRow
                className="cursor-pointer"
                // Left click opens the side preview; right click jumps
                // straight into the call page in a new tab, like the job list.
                onClick={() => setQuickViewSid(call.callSid)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  window.open(
                    `/calls/${call.callSid}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <TableCell>
                  {call.direction === "inbound" ? (
                    <PhoneIncoming className="size-4 text-muted-foreground" />
                  ) : (
                    <PhoneOutgoing className="size-4 text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell>
                  <CallPartyCell
                    party={callParty(call, "from")}
                    onAddClient={setAddingFor}
                  />
                </TableCell>
                <TableCell>
                  <CallPartyCell
                    party={callParty(call, "to")}
                    onAddClient={setAddingFor}
                  />
                </TableCell>
                <TableCell>
                  <CallStatusBadge status={call.status} />
                </TableCell>
                <TableCell className="text-sm">
                  {answeredBy(call) ?? <Dash />}
                </TableCell>
                {/*
                  Truncated, with the whole value on hover. Call flows and ad
                  group sources carry names like "SURE TX MCKINNEY (UNIVERSITY)
                  LSA -", far past any column width worth giving them; under
                  `table-fixed` an unclipped cell does not widen its column, it
                  spills over the next one.
                */}
                <TableCell className="truncate text-sm" title={call.flowName ?? undefined}>
                  {call.flowName ?? <Dash />}
                </TableCell>
                <TableCell
                  className="truncate text-sm"
                  title={call.sourceId ? sourceName(call.sourceId) : undefined}
                >
                  {call.sourceId ? sourceName(call.sourceId) : <Dash />}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <CallTagsCell call={call} inRow />
                </TableCell>
                <TableCell>
                  {call.dealId ? <CallJobTagsCell deal={dealsById.get(call.dealId)} /> : <Dash />}
                </TableCell>
                <TableCell>
                  {call.dealId ? (
                    <CallJobCell deal={dealsById.get(call.dealId)} isLoading={dealsLoading} />
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatCallTime(call.startedAt)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatDuration(call.durationSeconds)}
                </TableCell>
                <TableCell className="text-right">
                  {call.recordingSid ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7"
                      aria-label={
                        previewSid === call.callSid
                          ? "Close player"
                          : "Play recording"
                      }
                      onClick={(e) => {
                        // The row click opens the call page; this stays put.
                        e.stopPropagation();
                        setPreviewSid((sid) =>
                          sid === call.callSid ? null : call.callSid,
                        );
                      }}
                    >
                      {previewSid === call.callSid ? (
                        <X className="size-4" />
                      ) : (
                        <Play className="size-4" />
                      )}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
              {previewSid === call.callSid ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 py-2">
                    <RecordingPreview callSid={call.callSid} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <CallQuickView
        callSid={quickViewSid}
        // The row is already in hand — the panel draws it at once instead of
        // waiting for the detail request to say the same thing.
        call={quickViewSid ? calls.find((c) => c.callSid === quickViewSid) : undefined}
        open={!!quickViewSid}
        onOpenChange={(open) => !open && setQuickViewSid(null)}
      />

      <NewClientFromCallDialog
        phone={addingFor}
        onClose={() => setAddingFor(null)}
      />
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * The job a call is attached to, as a link. Fetched per deal id — the query
 * cache collapses repeat rows (and the Tags cell) into one request.
 */
function CallJobCell({
  deal,
  isLoading,
}: {
  deal?: { id: string; dealNumber: string };
  isLoading: boolean;
}) {
  if (isLoading) {
    return <span className="inline-block h-4 w-12 animate-pulse rounded bg-muted" />;
  }
  if (!deal) return <Dash />;
  return (
    <Link
      href={`/deals/${deal.id}`}
      className="font-medium underline-offset-2 hover:text-brand hover:underline"
      // The row click opens the side preview; this goes to the job instead.
      onClick={(e) => e.stopPropagation()}
    >
      #{deal.dealNumber}
    </Link>
  );
}

/**
 * The linked job's tags — a different question from the call's own tags in
 * the column beside it, which is why both columns exist: the job is
 * "Warranty", the call that booked it "SPAM CALLER".
 */
function CallJobTagsCell({ deal }: { deal?: { tagIds?: string[] } }) {
  if (!deal?.tagIds?.length) return <Dash />;
  return <JobTagChips ids={deal.tagIds} max={2} />;
}
