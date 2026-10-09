"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { WzScrollGrid, type WzScrollColumn } from "@/components/workiz/scroll-grid";
import { WzTableEmpty } from "@/components/workiz/table-empty";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealsByIds } from "@/features/deals/hooks";
import { useJobSourceName } from "@/features/job-sources/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { useCallFieldsStore, visibleCallColumns, type CallColumn } from "../fields";
import { answeredBy, callParty, linkedDealIds, type CallRecord } from "../lib";
import { formatWzCallDuration, formatWzCallTime } from "../workiz-format";
import { CallPartyCell } from "./call-party-cell";
import { CallQuickView } from "./call-quick-view";
import { CallStatusGlyph } from "./call-status-glyph";
import { CallTagsCell } from "./call-tags-cell";
import { NewClientFromCallDialog } from "./new-client-from-call-dialog";
import { RecordingPreview } from "./recording-preview";

/**
 * Workiz's call grid (callspage_wz_01 / _02): the kit's scroll grid in a
 * 1px #ddd frame — the header pinned to the page's top, the rows scrolling
 * sideways in their own box when the columns are wider than the page, and
 * growing to fill it when they are not (`WzScrollGrid`) — 80px rows of
 * 20px cells (14px/16px #404040, dotted #cfcfcf rules), the Time column
 * marked as the one the rows are ordered by (newest first: the bar at the
 * foot). `table-fixed`, every column at a declared width, so a value that
 * lands late never shoves its neighbours — and a long one is clipped.
 */
const HEAD = "bg-muted border-b border-input";
/** Workiz's 20px all round (the Table's fixed layout would give 10px sides), top-aligned. */
const CELL = "overflow-hidden whitespace-nowrap p-5 align-top";

/** Workiz pads its grid to ten rows (react-table `minRows`). */
const MIN_ROWS = 10;

/** The widths this table remembers; a key of its own, so old widths of other columns don't apply. */
const TABLE_KEY = "calls-workiz";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** A job's money, as the jobs list's Total column reads it. */
const jobTotal = (d: Deal) => d.totals?.total ?? d.actualTotal ?? d.estimatedTotal;

/** The columns this viewer sees, in the order saved in the Fields drawer. */
function useColumns(): CallColumn[] {
  const { can } = usePermissions();
  const visible = useCallFieldsStore((s) => s.visible);
  const order = useCallFieldsStore((s) => s.order);
  return visibleCallColumns(visible, order, can("financials", "view"));
}

/**
 * The grid's columns: each at its Workiz minimum, or the width the reader
 * dragged it to — which it then keeps while the others grow to the page.
 */
function useScrollColumns(columns: CallColumn[]) {
  const defaults = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.width])), [columns]);
  const widths = useColumnWidths(TABLE_KEY, defaults);
  const scrollColumns: WzScrollColumn[] = columns.map((c) => ({
    id: c.id,
    label: c.label,
    width: widths.widthOf(c.id),
    fixed: c.fixed || widths.isSet(c.id),
  }));
  return { ...widths, scrollColumns };
}

/**
 * The grid's shell while the log is in flight: the same frame, header and
 * widths, rows of the same 80px — the first painted frame already has the
 * geometry the calls land into.
 */
export function CallsTableSkeleton({ rows = MIN_ROWS }: { rows?: number }) {
  const columns = useColumns();
  const { scrollColumns } = useScrollColumns(columns);
  return (
    <WzScrollGrid
      columns={scrollColumns}
      busy
      role="status"
      aria-label="Loading calls"
      header={() =>
        columns.map((c) => (
          <TableHead key={c.id} className={cn(HEAD, "truncate")} sort={c.id === "time" ? "desc" : undefined}>
            {c.label}
          </TableHead>
        ))
      }
    >
      <TableBody>
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i} aria-hidden className="h-20">
            {columns.map((c) => (
              <TableCell key={c.id} className={CELL}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </WzScrollGrid>
  );
}

export function CallsTable({
  calls,
  empty,
}: {
  calls: CallRecord[];
  /** What the white wash says over an empty grid (Workiz: "No … Found"). */
  empty?: ReactNode;
}) {
  const sourceName = useJobSourceName();
  const columns = useColumns();
  // The reader's own widths for this table; the registry only sets the start.
  const { scrollColumns, setWidth, reset } = useScrollColumns(columns);
  // One request for every job on the page, not one per row — and the page
  // brings these with its rows (`useCallsList`), so here they are read.
  const dealIds = useMemo(() => linkedDealIds(calls), [calls]);
  const { data: linkedDeals, isLoading: dealsLoading } = useDealsByIds(dealIds);
  const dealsById = useMemo(() => new Map((linkedDeals ?? []).map((d) => [d.id, d])), [linkedDeals]);
  // The number an unknown caller is being turned into a client for.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  // The call whose recording is playing inline; one preview at a time.
  const [previewSid, setPreviewSid] = useState<string | null>(null);
  // The call open in the side preview panel.
  const [quickViewSid, setQuickViewSid] = useState<string | null>(null);

  const cell = (call: CallRecord, column: CallColumn): ReactNode => {
    const deal = call.dealId ? dealsById.get(call.dealId) : undefined;
    switch (column.id) {
      case "status":
        return <CallStatusGlyph call={call} />;
      case "from":
        return <CallPartyCell party={callParty(call, "from")} onAddClient={setAddingFor} />;
      case "to":
        return <CallPartyCell party={callParty(call, "to")} onAddClient={setAddingFor} />;
      case "time":
        return (
          <>
            <div className="leading-4">{formatWzCallTime(call.startedAt)}</div>
            <div className="mt-[5px] flex items-center gap-1.5 text-xs leading-4 text-wz-caption">
              {formatWzCallDuration(call.durationSeconds)}
              {call.recordingSid ? (
                <button
                  type="button"
                  aria-label={previewSid === call.callSid ? "Close player" : "Play recording"}
                  onClick={(e) => {
                    // The row opens the side preview; this stays put.
                    e.stopPropagation();
                    setPreviewSid((sid) => (sid === call.callSid ? null : call.callSid));
                  }}
                  className="grid size-4 place-items-center rounded-full bg-wz-link text-white hover:bg-brand"
                >
                  {previewSid === call.callSid ? (
                    <Pause className="size-2.5 fill-current" strokeWidth={0} />
                  ) : (
                    <Play className="size-2.5 translate-x-px fill-current" strokeWidth={0} />
                  )}
                </button>
              ) : null}
            </div>
          </>
        );
      case "flow":
        // Clipped with an ellipsis, the whole name on hover: flow and source
        // names run long ("SURE TX MCKINNEY (UNIVERSITY) LSA -").
        return call.flowName ? <span className="block truncate" title={call.flowName}>{call.flowName}</span> : null;
      case "source": {
        const name = call.sourceId ? sourceName(call.sourceId) : "";
        return name ? <span className="block truncate" title={name}>{name}</span> : null;
      }
      case "tags":
        return <CallTagsCell call={call} inRow look="cell" />;
      case "answeredBy": {
        const who = answeredBy(call);
        return who ? <span className="block truncate" title={who}>{who}</span> : null;
      }
      case "job":
        if (!call.dealId) return null;
        if (dealsLoading && !deal) return <span className="inline-block h-4 w-12 animate-pulse rounded bg-muted" />;
        return deal ? (
          <Link
            href={`/deals/${deal.id}`}
            // The row click opens the side preview; this goes to the job instead.
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-wz-close-icon no-underline hover:underline"
          >
            Job {deal.dealNumber}
          </Link>
        ) : null;
      case "revenue": {
        // Workiz leaves a job with nothing billed blank ("Job 375982", no revenue).
        const total = deal ? jobTotal(deal) : undefined;
        return typeof total === "number" && total > 0 ? <span className="tabular-nums">{money.format(total)}</span> : null;
      }
      case "jobTags":
        // The linked job's tags — a different question from the call's own.
        return deal?.tagIds?.length ? <JobTagChips ids={deal.tagIds} max={2} /> : null;
    }
  };

  return (
    <WzScrollGrid
      columns={scrollColumns}
      header={(widthOf) =>
        columns.map((c) => (
          <ResizableHead
            key={c.id}
            columnId={c.id}
            label={c.label}
            width={widthOf(c.id)}
            onResize={(px) => setWidth(c.id, px)}
            onReset={reset}
            sort={c.id === "time" ? "desc" : undefined}
            className={HEAD}
          >
            {c.label}
          </ResizableHead>
        ))
      }
      after={
        <>
          {calls.length === 0 && empty ? <WzTableEmpty title={empty} /> : null}

          <CallQuickView
            callSid={quickViewSid}
            // The row is already in hand — the panel draws it at once instead of
            // waiting for the detail request to say the same thing.
            call={quickViewSid ? calls.find((c) => c.callSid === quickViewSid) : undefined}
            open={!!quickViewSid}
            onOpenChange={(open) => !open && setQuickViewSid(null)}
          />

          <NewClientFromCallDialog phone={addingFor} onClose={() => setAddingFor(null)} />
        </>
      }
    >
      <TableBody>
        {calls.map((call) => (
          <Fragment key={call.callSid}>
            <TableRow
              className="group/row h-20 cursor-pointer"
              // Left click opens the side preview; right click opens the
              // call's own page in a new tab, like the job list.
              onClick={() => setQuickViewSid(call.callSid)}
              onContextMenu={(e) => {
                e.preventDefault();
                window.open(`/calls/${call.callSid}`, "_blank", "noopener,noreferrer");
              }}
            >
              {columns.map((c) => (
                <TableCell key={c.id} className={CELL}>
                  {cell(call, c)}
                </TableCell>
              ))}
            </TableRow>
            {previewSid === call.callSid ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="bg-muted/30 px-5 py-2">
                  <RecordingPreview callSid={call.callSid} />
                </TableCell>
              </TableRow>
            ) : null}
          </Fragment>
        ))}
        {/* Workiz's grid never runs shorter than ten rows: blank striped
            rows keep the rules going. */}
        {Array.from({ length: Math.max(0, MIN_ROWS - calls.length) }, (_, i) => (
          <TableRow key={`pad-${i}`} aria-hidden className="h-20">
            {columns.map((c) => (
              <TableCell key={c.id} className={CELL} />
            ))}
          </TableRow>
        ))}
      </TableBody>
    </WzScrollGrid>
  );
}
