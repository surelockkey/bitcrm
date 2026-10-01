"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, Search } from "lucide-react";
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
  const { can } = usePermissions();
  const denied = useDenied();
  const canView = can("estimates", "view");
  const range = useReportRange(DEFAULT_ESTIMATE_PRESET);
  const [status, setStatus] = useState<EstimateStatus | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [exporting, setExporting] = useState(false);
  const { from, to } = range.range;
  const summary = useEstimateReportSummary({ from, to }, canView && !range.error);

  // `canView` still gates the query — it must not fetch on a maybe.
  // The refusal is the other way round: only once the answer is in.
  if (denied("estimates", "view")) return <NoAccess what="estimates" />;

  const params: Omit<EstimateReportParams, "cursor"> = {
    ...(from && { from }),
    ...(to && { to }),
    ...(status !== "all" && { status }),
    ...(search && { search }),
  };
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
        <p className="text-xs text-muted-foreground">Create estimates from a job&apos;s Estimates tab.</p>
        <div className="ml-auto">
          <DateRangeControl presets={ESTIMATE_DATE_PRESETS} state={range} />
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {range.error ? (
          <p role="alert" className="text-sm text-destructive">
            {range.error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Filter by status">
          {ESTIMATE_STATUSES.map((s) => {
            const card = summary.data?.[s];
            return (
              <ReportCard
                key={s}
                value={`${(card?.count ?? 0).toLocaleString("en-US")} Worth ${money(card?.amount)}`}
                caption={ESTIMATE_STATUS_LABELS[s]}
                swatch={ESTIMATE_STATUS_COLORS[s]}
                loading={summary.isLoading}
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
          {summary.data ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {summary.data.total.count.toLocaleString("en-US")} estimates · {money(summary.data.total.amount)}
            </span>
          ) : null}
          <span className="flex-1" />
          <ExportButton busy={exporting} disabled={!!range.error} onClick={() => void runExport()} />
        </div>
        <EstimatesTable params={params} status={status === "all" ? undefined : status} enabled={canView && !range.error} />
      </div>
    </div>
  );
}

function EstimatesTable({
  params,
  status,
  enabled,
}: {
  params: Omit<EstimateReportParams, "cursor">;
  status?: EstimateStatus;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pageSize, setPageSize] = usePageSize("estimates");
  const q = useEstimateReport({ ...params, limit: pageSize }, enabled);
  const count = useEstimateReportCount(params, enabled);
  const pager = usePager(pagedSource(q, (page: { items: Estimate[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ params, pageSize }),
  });
  const rows: Estimate[] = pager.items;
  const { map: contacts } = useContactsByIds(rows.map((r) => r.contactId));
  const { map: users } = useUserMap(rows.filter((r) => !r.createdByName).map((r) => r.createdBy));
  // The reader's own widths for this list; the declarations only set the start.
  const { widthOf, setWidth, reset } = useColumnWidths("estimates", COLUMN_WIDTHS);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load estimates")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
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
    <div className="space-y-3">
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
      <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
    </div>
  );
}
