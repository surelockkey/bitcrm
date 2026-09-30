"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePager, type Pager } from "@/lib/paging/use-pager";
import { getDealsByIds } from "@/features/deals/api";
import { personName } from "@/features/deals/person-name";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { formatMoney } from "@/features/inventory/products/lib";
import { returnReasonLabel } from "@/features/inventory/transfers/lib";
import { useUserNames } from "@/features/inventory/user-containers/hooks";
import { getUserNames } from "@/features/users/api";
import { listReportPage, type TabRows } from "../api";
import { describeLogEntry, jobLabel } from "../describe";
import {
  EXPORT_CAP,
  EXPORT_PAGE_SIZE,
  drainPages,
  logCsvRows,
  returnsCsvRows,
  techNamesOf,
  toCsv,
  usageCsvRows,
} from "../export";
import { formatDateTime, formatJobDate, formatQty } from "../format";
import { useJobNumbers, useReportRows, useReportSummary } from "../hooks";
import type { InventoryUsageRow, ReportLogEntry, ReportQuery, ReportSummary, ReportTab } from "../types";
import { REPORT_ROW, ReportTable, type ReportColumn } from "./report-table";

/** Workiz's page sizes; the report opens on ten. */
export const REPORT_PAGE_SIZES = [10, 25, 50, 100] as const;

export interface PanelProps {
  query: ReportQuery;
  /** What the Search box holds; `query.search` is the settled term the server gets. */
  search: string;
  onSearch: (value: string) => void;
  pageSize: number;
  onPageSize: (size: number) => void;
  /** `financials.view`: prices, costs and money totals. */
  money: boolean;
  /** The permissions are still loading: rows wait, so no money shows before the answer. */
  permsLoading: boolean;
  /** `deals.view`: job numbers can be looked up. */
  canDeals: boolean;
}

/* ------------------------------------------------------------------ shared */

const cash = (n: number | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? formatMoney(n) : "—";

const orDash = (v: string | undefined | null): string => (v && v.trim() ? v : "—");

/** One cell's text, clipped under `table-fixed`, whole in its tooltip. */
function Cell({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <TableCell className={className ? `truncate ${className}` : "truncate"} title={title}>
      {children}
    </TableCell>
  );
}

function JobLink({ dealId, number }: { dealId: string; number?: string | number }) {
  return (
    <Link href={`/deals/${dealId}`} className="underline-offset-2 hover:text-brand hover:underline">
      {jobLabel(number)}
    </Link>
  );
}

/** The rows, the count and the pager every tab shares. */
function usePanel<T extends ReportTab>(tab: T, { query, pageSize, permsLoading }: PanelProps) {
  const rows = useReportRows(tab, query, pageSize);
  const summary = useReportSummary(tab, query);
  const pager = usePager(pagedSource(rows), {
    total: summary.data?.rows,
    totalIsFloor: summary.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ query, pageSize }),
  });
  // Nothing to show yet: the table draws itself at its final size instead.
  const loading = permsLoading || (rows.isLoading && !rows.data);
  const skeletonRows = useSkeletonRows(
    `inventory-report-${tab}`,
    pageSize,
    summary.data?.rows,
    loading || pager.isStale ? undefined : pager.items.length,
  );
  const status: ReactNode =
    rows.isError && !rows.data ? (
      <span className="flex items-center gap-3">
        Couldn&apos;t load the report.
        <Button variant="outline" size="sm" onClick={() => void rows.refetch()}>
          Retry
        </Button>
      </span>
    ) : !loading && pager.items.length === 0 ? (
      "No results for these dates and filters."
    ) : undefined;

  // The count and totals of the last filter stay up, dimmed, while the new ones are counted.
  const totalsStale = !!summary.isPlaceholderData;

  return { rows, summary, pager, loading, skeletonRows, status, totalsStale };
}

/**
 * A total: a bar while it is first counted — and while the permissions load,
 * so a money total never shows before it is known the reader may see it —
 * and "+" when the count stopped at its ceiling.
 */
function totalCell(
  summary: { data?: ReportSummary; isLoading: boolean },
  pick: (s: ReportSummary) => string,
  pending: boolean,
): ReactNode {
  if (pending || (!summary.data && summary.isLoading)) return <Skeleton className="h-4 w-14" />;
  if (!summary.data) return "—";
  return `${pick(summary.data)}${summary.data.atLeast ? "+" : ""}`;
}

function downloadCsv(csv: string, filename: string) {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export: the whole filtered window, a hundred rows a request, up to the cap —
 * the button counts the rows as they arrive.
 */
function useExport<T extends ReportTab>(
  tab: T,
  query: ReportQuery,
  filename: string,
  build: (rows: TabRows[T][]) => Promise<Record<string, string>[]>,
) {
  const [progress, setProgress] = useState<number | null>(null);
  const run = async () => {
    setProgress(0);
    try {
      const { rows, capped } = await drainPages(
        (cursor) => listReportPage(tab, query, cursor, EXPORT_PAGE_SIZE),
        { cap: EXPORT_CAP, onProgress: setProgress },
      );
      downloadCsv(toCsv(await build(rows)), filename);
      if (capped) {
        toast.warning(
          `Exported the first ${EXPORT_CAP.toLocaleString("en-US")} rows. Narrow the dates or filters to export the rest.`,
        );
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setProgress(null);
    }
  };
  return { progress, run };
}

function Toolbar({
  search,
  onSearch,
  pageSize,
  onPageSize,
  exporting,
  exportTotal,
  canExport,
  onExport,
}: {
  search: string;
  onSearch: (v: string) => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  exporting: number | null;
  exportTotal?: number;
  canExport: boolean;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search"
          placeholder="Search"
          className="h-9 pl-8"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <select
        aria-label="Page size"
        className="h-9 rounded-md border bg-transparent px-2 text-sm"
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
      >
        {REPORT_PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        className="h-9 min-w-[10rem] justify-start gap-1.5 tabular-nums"
        disabled={exporting !== null || !canExport}
        onClick={onExport}
      >
        <Download className="size-4" />
        <span aria-live="polite">
          {exporting === null
            ? "Export"
            : `Exporting… ${exporting.toLocaleString("en-US")}${
                exportTotal ? ` / ${Math.min(exportTotal, EXPORT_CAP).toLocaleString("en-US")}` : ""
              }`}
        </span>
      </Button>
    </div>
  );
}

/**
 * The pager under the table. Its own "Rows per page" is hidden: the report's
 * page size sits in the toolbar, where Workiz has it, and offers 10 — which
 * the shared pager's list (25/50/100) does not.
 */
function ReportPager<T>({
  pager,
  pageSize,
  onPageSize,
}: {
  pager: Pager<T>;
  pageSize: number;
  onPageSize: (n: number) => void;
}) {
  return (
    <ListPagination
      pager={pager}
      size={pageSize}
      onSizeChange={onPageSize}
      reserveSpace
      className="[&>div:last-child]:hidden"
    />
  );
}

/* ------------------------------------------------------------------ Usage */

const USAGE_COLUMNS: ReportColumn[] = [
  { id: "item", label: "Item", width: 240 },
  { id: "sku", label: "SKU", width: 120 },
  { id: "job", label: "Job", width: 130 },
  { id: "client", label: "Client", width: 170 },
  { id: "jobDate", label: "Job date", width: 150 },
  { id: "techs", label: "Techs", width: 170 },
  { id: "qty", label: "Qty", width: 90 },
];
const USAGE_MONEY_COLUMNS: ReportColumn[] = [
  ...USAGE_COLUMNS,
  { id: "price", label: "Price", width: 110 },
  { id: "cost", label: "Cost", width: 110 },
  { id: "total", label: "Total", width: 120 },
];

const hasTechNames = (r: InventoryUsageRow): boolean =>
  Array.isArray(r.techNames) ? r.techNames.length > 0 : !!r.techNames?.trim();

export function UsagePanel(props: PanelProps) {
  const { query, money } = props;
  const { summary, pager, loading, skeletonRows, status, totalsStale } = usePanel("usage", props);
  const items = pager.items as InventoryUsageRow[];

  // Techs the rows name only by id, looked up by name alone (no directory read).
  const unnamed = useMemo(
    () => items.filter((r) => !hasTechNames(r)).flatMap((r) => r.techIds ?? []),
    [items],
  );
  const { names } = useUserNames(unnamed);

  const exporter = useExport("usage", query, `inventory-usage-${query.from}-${query.to}.csv`, async (rows) => {
    const known = new Map(names);
    const missing = [
      ...new Set(rows.filter((r) => !hasTechNames(r)).flatMap((r) => r.techIds ?? [])),
    ].filter((id) => !known.has(id));
    try {
      for (let i = 0; i < missing.length; i += 200) {
        for (const u of await getUserNames(missing.slice(i, i + 200))) {
          const name = personName(u);
          if (name) known.set(u.id, name);
        }
      }
    } catch {
      // Names are a nicety: the export goes out with the techs it could name.
    }
    return usageCsvRows(rows, { money, summary: summary.data, techName: (id) => known.get(id) });
  });

  const columns = money ? USAGE_MONEY_COLUMNS : USAGE_COLUMNS;
  const totals: ReactNode[] = [
    "Totals",
    "",
    "",
    "",
    "",
    "",
    totalCell(summary, (s) => formatQty(s.qty), loading),
    // Workiz sums unit prices here; that number means nothing, so the cell stays empty.
    ...(money
      ? ["", totalCell(summary, (s) => cash(s.cost), loading), totalCell(summary, (s) => cash(s.total), loading)]
      : []),
  ];

  return (
    <div className="flex flex-col">
      <Toolbar
        search={props.search}
        onSearch={props.onSearch}
        pageSize={props.pageSize}
        onPageSize={props.onPageSize}
        exporting={exporter.progress}
        exportTotal={summary.data?.rows}
        canExport={!loading && items.length > 0}
        onExport={() => void exporter.run()}
      />
      <ReportTable
        tableKey="inventory-report-usage"
        columns={columns}
        loading={loading}
        skeletonRows={skeletonRows}
        stale={pager.isStale}
        totals={totals}
        totalsStale={totalsStale}
        status={status}
      >
        {items.map((r, i) => {
          const techs = techNamesOf(r, (id) => names.get(id));
          return (
            <TableRow key={`${r.dealId}:${r.productId}:${i}`} className={REPORT_ROW}>
              <Cell title={r.productName}>{orDash(r.productName)}</Cell>
              <Cell title={r.sku}>{orDash(r.sku)}</Cell>
              <Cell>
                <JobLink dealId={r.dealId} number={r.dealNumber} />
                {r.source === "workiz" ? (
                  <span
                    title="Imported from Workiz"
                    className="ml-1.5 rounded-sm border px-1 text-[10px] font-medium text-muted-foreground"
                  >
                    Workiz
                  </span>
                ) : null}
              </Cell>
              <Cell title={r.clientName}>{orDash(r.clientName)}</Cell>
              <Cell>{formatJobDate(r.jobDate)}</Cell>
              <Cell title={techs}>{orDash(techs)}</Cell>
              <Cell className="tabular-nums">{formatQty(r.qty)}</Cell>
              {money ? (
                <>
                  <Cell className="tabular-nums">{cash(r.unitPrice)}</Cell>
                  <Cell className="tabular-nums">{cash(r.unitCost)}</Cell>
                  <Cell className="tabular-nums">{cash(r.total)}</Cell>
                </>
              ) : null}
            </TableRow>
          );
        })}
      </ReportTable>
      <ReportPager pager={pager} pageSize={props.pageSize} onPageSize={props.onPageSize} />
    </div>
  );
}

/* ------------------------------------------------------------------ Returns */

const RETURNS_COLUMNS: ReportColumn[] = [
  { id: "item", label: "Item", width: 260 },
  { id: "sku", label: "SKU", width: 120 },
  { id: "returnDate", label: "Return date", width: 210 },
  { id: "qty", label: "Qty", width: 90 },
  { id: "reason", label: "Reason", width: 130 },
  { id: "location", label: "Location", width: 170 },
  { id: "user", label: "User", width: 170 },
];

export function ReturnsPanel(props: PanelProps) {
  const { query } = props;
  const { summary, pager, loading, skeletonRows, status, totalsStale } = usePanel("returns", props);
  const items = pager.items as ReportLogEntry[];
  const exporter = useExport("returns", query, `inventory-returns-${query.from}-${query.to}.csv`, async (rows) =>
    returnsCsvRows(rows, summary.data),
  );

  const totals: ReactNode[] = ["Totals", "", "", totalCell(summary, (s) => formatQty(s.qty), loading), "", "", ""];

  return (
    <div className="flex flex-col">
      <Toolbar
        search={props.search}
        onSearch={props.onSearch}
        pageSize={props.pageSize}
        onPageSize={props.onPageSize}
        exporting={exporter.progress}
        exportTotal={summary.data?.rows}
        canExport={!loading && items.length > 0}
        onExport={() => void exporter.run()}
      />
      <ReportTable
        tableKey="inventory-report-returns"
        columns={RETURNS_COLUMNS}
        loading={loading}
        skeletonRows={skeletonRows}
        stale={pager.isStale}
        totals={totals}
        totalsStale={totalsStale}
        status={status}
      >
        {items.map((r) => (
          <TableRow key={r.id} className={REPORT_ROW}>
            <Cell title={r.productName}>{orDash(r.productName)}</Cell>
            <Cell title={r.sku}>{orDash(r.sku)}</Cell>
            <Cell>{formatDateTime(r.createdAt)}</Cell>
            <Cell className="tabular-nums">{formatQty(r.quantity)}</Cell>
            <Cell>{r.reason ? returnReasonLabel(r.reason) : "—"}</Cell>
            <Cell title={r.fromName}>{orDash(r.fromName)}</Cell>
            <Cell title={r.userName}>{orDash(r.userName)}</Cell>
          </TableRow>
        ))}
      </ReportTable>
      <ReportPager pager={pager} pageSize={props.pageSize} onPageSize={props.onPageSize} />
    </div>
  );
}

/* ------------------------------------------------------------------ Action log */

const LOG_COLUMNS: ReportColumn[] = [
  { id: "item", label: "Item", width: 220 },
  { id: "sku", label: "SKU", width: 120 },
  { id: "user", label: "User", width: 160 },
  { id: "time", label: "Time", width: 210 },
  { id: "description", label: "Description", width: 340 },
  { id: "job", label: "Job", width: 110 },
];

export function LogPanel(props: PanelProps) {
  const { query, canDeals } = props;
  const { summary, pager, loading, skeletonRows, status } = usePanel("log", props);
  const items = pager.items as ReportLogEntry[];
  const jobNumbers = useJobNumbers(items, canDeals);

  const exporter = useExport("log", query, `inventory-action-log-${query.from}-${query.to}.csv`, async (rows) => {
    const known = new Map(jobNumbers);
    const missing = [
      ...new Set(rows.filter((r) => r.dealId && r.dealNumber === undefined).map((r) => r.dealId as string)),
    ].filter((id) => !known.has(id));
    if (canDeals) {
      try {
        for (let i = 0; i < missing.length; i += 100) {
          for (const d of await getDealsByIds(missing.slice(i, i + 100))) known.set(d.id, d.dealNumber);
        }
      } catch {
        // The descriptions still read "in job"; the export is not held back for a number.
      }
    }
    return logCsvRows(rows, known);
  });

  return (
    <div className="flex flex-col">
      <Toolbar
        search={props.search}
        onSearch={props.onSearch}
        pageSize={props.pageSize}
        onPageSize={props.onPageSize}
        exporting={exporter.progress}
        exportTotal={summary.data?.rows}
        canExport={!loading && items.length > 0}
        onExport={() => void exporter.run()}
      />
      <ReportTable
        tableKey="inventory-report-log"
        columns={LOG_COLUMNS}
        loading={loading}
        skeletonRows={skeletonRows}
        stale={pager.isStale}
        status={status}
      >
        {items.map((r) => {
          const number = r.dealNumber ?? (r.dealId ? jobNumbers.get(r.dealId) : undefined);
          const description = describeLogEntry(r, { jobNumber: number });
          return (
            <TableRow key={r.id} className={REPORT_ROW}>
              <Cell title={r.productName}>{orDash(r.productName)}</Cell>
              <Cell title={r.sku}>{orDash(r.sku)}</Cell>
              <Cell title={r.userName}>{orDash(r.userName)}</Cell>
              <Cell>{formatDateTime(r.createdAt)}</Cell>
              <Cell title={description}>{description}</Cell>
              <Cell>{r.dealId ? <JobLink dealId={r.dealId} number={number} /> : ""}</Cell>
            </TableRow>
          );
        })}
      </ReportTable>
      <ReportPager pager={pager} pageSize={props.pageSize} onPageSize={props.onPageSize} />
    </div>
  );
}
