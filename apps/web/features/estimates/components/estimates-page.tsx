"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  estimateDepositDue,
  estimateReportAmount,
  type Estimate,
  type EstimateStatus,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { heldPager, useHeldView } from "@/features/billing/use-held-view";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { useUserMap } from "@/features/deals/hooks";
import { formatMoney } from "@/features/billing/lib";
import { NoAccess } from "@/features/billing/components/list-bits";
import { exportEstimateReport } from "@/features/reports/billing/api";
import { useEstimateReport, useEstimateReportCount, useEstimateReportSummary } from "@/features/reports/billing/hooks";
import {
  DEFAULT_ESTIMATE_PRESET,
  ESTIMATE_DATE_PRESETS,
  ESTIMATE_STATUS_COLORS,
  downloadCsv,
  workizDate,
  type EstimateReportParams,
} from "@/features/reports/billing/lib";
import { DateRangeControl, ExportButton, ReportCard, money, useReportRange } from "@/features/reports/billing/components/report-bits";
import { NewClientEstimateDialog } from "./new-client-estimate-dialog";
import { estimateStatusLabel } from "../lib";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { estimateHref } from "@/features/billing/components/client-documents";

/**
 * Every column of the list — Workiz's Estimates page, in its order — with the
 * width it starts at.
 *
 * `table-fixed` on purpose: the client name comes from its own contacts
 * request and lands after the rows, and under auto layout the grid would
 * re-measure itself when it does. Declared once — the colgroup and the
 * headers are both built from here, and the reader's own widths are kept
 * under `estimates`, the same name the page size is saved under.
 */
const COLUMNS: { id: string; label: string; width: number; right?: boolean }[] = [
  { id: "number", label: "Estimate", width: 120 },
  { id: "name", label: "Estimate Name", width: 200 },
  { id: "client", label: "Client", width: 190 },
  { id: "created", label: "Created", width: 170 },
  { id: "total", label: "Amount", width: 130, right: true },
  { id: "status", label: "Status", width: 150 },
  { id: "job", label: "Source", width: 130 },
  { id: "deposit", label: "Deposit due", width: 120, right: true },
];

const COLUMN_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width]),
);

/** Workiz shows when an estimate was approved, declined or won, under its status. */
const UPDATED_ON: Partial<Record<EstimateStatus, keyof Estimate>> = {
  approved: "approvedAt",
  declined: "declinedAt",
  won: "wonAt",
};

/**
 * Workiz's Estimates page (`/root/estimates`, also its Reports tile): All time
 * by default; six status cards ("N Worth $X") for the chosen created-date
 * window, each one the status filter; the status select, search, Workiz's
 * columns and its CSV.
 */
export function EstimatesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("estimates", "view");
  const range = useReportRange(DEFAULT_ESTIMATE_PRESET);
  const [status, setStatus] = useState<EstimateStatus | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { from, to } = range.range;
  // `canView` still gates the queries — they must not fetch on a maybe. Until
  // the permissions answer, a disabled query is not an empty answer: the cards
  // would read "0 Worth $0.00" and the list "No estimates yet".
  const enabled = canView && !range.error;
  const summary = useEstimateReportSummary({ from, to }, enabled);
  // Another date window keeps the numbers on the cards until its own are in.
  const cards = useHeldView(summary.data, [summary.data], !permsLoading && settled(summary));

  const params: Omit<EstimateReportParams, "cursor"> = {
    ...(from && { from }),
    ...(to && { to }),
    ...(status !== "all" && { status }),
    ...(search && { search }),
  };
  const list = useEstimateRows(params, enabled, !permsLoading);
  // The cards with their numbers, the rows and the names beside them come up
  // in one frame — the numbers widen the cards and the names the rows, so
  // anything drawn before them moved when they landed.
  const ready = usePageReady(cards.shown && list.shown);

  // The refusal is the other way round: only once the answer is in.
  if (denied("estimates", "view")) return <NoAccess what="estimates" />;

  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportEstimateReport(params);
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the estimates"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Estimates</h1>
        {/* Held invisible, at its height, until the page is up: "Add New" waits
            for the permissions and would push the dates aside when it came. */}
        <div className={cn("ml-auto flex flex-wrap items-center gap-3", !ready && "invisible")}>
          <DateRangeControl presets={ESTIMATE_DATE_PRESETS} state={range} />
          {/* Workiz: "+ Add New" beside the dates asks for the client, then opens the new estimate. */}
          {can("estimates", "create") ? (
            <Button className="h-9 gap-1.5 rounded-pill px-4 font-semibold" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add New
            </Button>
          ) : null}
        </div>
      </div>
      <NewClientEstimateDialog open={adding} onOpenChange={setAdding} />
      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {range.error ? (
          <p role="alert" className="text-sm text-destructive">
            {range.error}
          </p>
        ) : null}
        {ready ? (
          <>
            <div
              className={cn("grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6", cards.held && "opacity-60")}
              aria-label="Filter by status"
              aria-busy={cards.held || undefined}
            >
              {ESTIMATE_STATUSES.map((s) => {
                const card = cards.view?.[s];
                return (
                  <ReportCard
                    key={s}
                    value={`${(card?.count ?? 0).toLocaleString("en-US")} Worth ${money(card?.amount)}`}
                    caption={ESTIMATE_STATUS_LABELS[s]}
                    swatch={ESTIMATE_STATUS_COLORS[s]}
                    active={status === s}
                    onClick={() => setStatus(status === s ? "all" : s)}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Status"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as EstimateStatus | "all")}
              >
                <option value="all">All statuses</option>
                {ESTIMATE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ESTIMATE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-9 pl-8" placeholder="Search estimate # or name" aria-label="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
              </div>
              {cards.view ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {cards.view.total.count.toLocaleString("en-US")} estimates · {money(cards.view.total.amount)}
                </span>
              ) : null}
              <span className="flex-1" />
              <ExportButton busy={exporting} disabled={!!range.error} onClick={() => void runExport()} />
            </div>
            <EstimatesTable list={list} status={status === "all" ? undefined : status} />
          </>
        ) : (
          <EstimatesSkeleton />
        )}
      </div>
    </div>
  );
}

/** The page before its first frame: the six cards, the filters, the list. */
function EstimatesSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading estimates">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {ESTIMATE_STATUSES.map((s) => (
          <Skeleton key={s} className="h-18 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Rows have no identity of their own while there are none; one empty list keeps the held view still. */
const NO_ROWS: Estimate[] = [];

/**
 * The list as the reader sees it: a page of rows, the clients and authors
 * printed beside them and the pager under them — complete, or the previous
 * complete one while the next is on its way.
 *
 * The clients are a second round trip that cannot start until the rows say
 * whose names to ask for, and authors of estimates made here come from the
 * user directory. Rows drawn before them filled in a beat later (an author's
 * "Added by" line makes the row taller and pushes every row under it).
 */
function useEstimateRows(params: Omit<EstimateReportParams, "cursor">, enabled: boolean, permsIn: boolean) {
  const [pageSize, setPageSize] = usePageSize("estimates");
  const q = useEstimateReport({ ...params, limit: pageSize }, enabled);
  const count = useEstimateReportCount(params, enabled);
  const pager = usePager(pagedSource(q, (page: { items: Estimate[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ params, pageSize }),
  });
  const rows: Estimate[] = pager.items.length ? pager.items : NO_ROWS;
  const contacts = useContactsByIds(rows.map((r) => r.contactId));
  const authorIds = rows.filter((r) => !r.createdByName).map((r) => r.createdBy);
  const users = useUserMap(authorIds);
  const complete =
    permsIn &&
    settled(q) &&
    settled(count) &&
    !contacts.isLoading &&
    !(authorIds.length > 0 && users.isLoading);
  const held = useHeldView(
    { rows, contacts: contacts.map, users: users.map, pager, error: q.error },
    [rows, contacts.map, users.map, pager.page, pager.total, q.error],
    complete,
  );
  return { ...held, pageSize, setPageSize, retry: () => void q.refetch() };
}

function EstimatesTable({ list, status }: { list: ReturnType<typeof useEstimateRows>; status?: EstimateStatus }) {
  const router = useRouter();
  const { rows, contacts, users, pager, error } = list.view;
  // The reader's own widths for this list; the declarations only set the start.
  const { widthOf, setWidth, reset } = useColumnWidths("estimates", COLUMN_WIDTHS);

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load estimates")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={list.retry}>Try again</Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileSpreadsheet className="size-6" />
        <p className="text-sm">{status ? `No ${estimateStatusLabel(status).toLowerCase()} estimates.` : "No estimates yet."}</p>
      </div>
    );
  }

  const open = (e: Estimate) => router.push(estimateHref(e));
  const author = (e: Estimate): string | undefined => {
    if (e.createdByName) return e.createdByName;
    const u = users.get(e.createdBy);
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || undefined : undefined;
  };

  return (
    // The previous set, dimmed, while the next one is on its way.
    <div className={cn("space-y-3", list.held && "opacity-60")} aria-busy={list.held || undefined}>
      <div className="overflow-x-auto border">
        <Table className="table-fixed">
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id) }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <ResizableHead
                  key={c.id}
                  columnId={c.id}
                  label={c.label}
                  width={widthOf(c.id)}
                  onResize={(px) => setWidth(c.id, px)}
                  onReset={reset}
                  className={c.right ? "text-right" : undefined}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const c = contacts.get(e.contactId);
              const by = author(e);
              const updatedKey = UPDATED_ON[e.status];
              const updated = updatedKey ? (e[updatedKey] as string | undefined) : undefined;
              return (
                <TableRow
                  key={e.id}
                  tabIndex={0}
                  className="cursor-pointer align-top"
                  onClick={() => open(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") open(e);
                  }}
                >
                  {/* Under `table-fixed` a cell that does not clip spills over
                      the next column instead of widening its own. */}
                  <TableCell className="truncate font-mono font-medium">#{e.number}</TableCell>
                  <TableCell className="truncate">{e.name || "—"}</TableCell>
                  <TableCell className="truncate">{c ? contactName(c) : "—"}</TableCell>
                  <TableCell className="overflow-hidden">
                    <span className="block truncate tabular-nums text-muted-foreground">{workizDate(e.createdAt)}</span>
                    {by ? <span className="block truncate text-xs text-muted-foreground">Added by {by}</span> : null}
                  </TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(estimateReportAmount(e))}</TableCell>
                  <TableCell className="overflow-hidden">
                    <EstimateStatusBadge status={e.status} />
                    {updated ? <span className="block truncate text-xs text-muted-foreground">Updated: {workizDate(updated)}</span> : null}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    {e.dealId ? (
                      <Link
                        href={`/deals/${e.dealId}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Job - {e.dealNumber} <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      // A client estimate (Workiz's "stub"): no job behind it.
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(estimateDepositDue(e))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ListPagination pager={list.held ? heldPager(pager) : pager} size={list.pageSize} onSizeChange={list.setPageSize} />
    </div>
  );
}
