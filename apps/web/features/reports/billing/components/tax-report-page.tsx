"use client";

import { useMemo, useState } from "react";
import { Percent, Search } from "lucide-react";
import { toast } from "sonner";
import {
  TAX_REPORT_BY,
  TAX_REPORT_BY_LABELS,
  type TaxReportBasis,
  type TaxReportBy,
  type TaxReportRow,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { DEFAULT_REPORT_PAGE_SIZE } from "@/features/payments/report";
import { exportTaxReport } from "../api";
import { useTaxReport } from "../hooks";
import { DEFAULT_TAX_PRESET, TAX_DATE_PRESETS, downloadCsv } from "../lib";
import { DateRangeControl, ExportButton, ReportFooter, SortHead, money, useReportRange } from "./report-bits";

type Col = "name" | "description" | "rate" | "amount" | "taxableAmount" | "nonTaxableAmount" | "jobs";

const COLUMNS: Record<TaxReportBasis, { id: Col; label: string; right?: boolean }[]> = {
  accrual: [
    { id: "name", label: "Name" },
    { id: "description", label: "Description" },
    { id: "rate", label: "Rate", right: true },
    { id: "amount", label: "Amount", right: true },
    { id: "taxableAmount", label: "Taxable Amount", right: true },
    { id: "nonTaxableAmount", label: "Non-Taxable Amount", right: true },
    { id: "jobs", label: "Jobs", right: true },
  ],
  paid: [
    { id: "name", label: "Name" },
    { id: "description", label: "Description" },
    { id: "rate", label: "Rate", right: true },
    { id: "amount", label: "Tax", right: true },
    { id: "taxableAmount", label: "Taxable Amount", right: true },
    { id: "jobs", label: "Jobs", right: true },
  ],
};

const KPI: Record<TaxReportBasis, string> = {
  accrual: "total tax on sold items",
  paid: "total tax from collected payments",
};

/**
 * Workiz Reports → Tax (`/root/tax_report/`): Accrual (tax on what was sold,
 * "By:" Job created / Job date / Job end date — this account opens on Job end
 * date) and Paid (tax on what was collected, by payment date). One row per
 * tax rate; This month by default; "Tax to show", search, CSV.
 */
export function TaxReportPage() {
  const { can } = usePermissions();
  const denied = useDenied();
  const canView = can("reports", "view") && can("financials", "view");
  const range = useReportRange(DEFAULT_TAX_PRESET);
  const [basis, setBasis] = useState<TaxReportBasis>("accrual");
  const [by, setBy] = useState<TaxReportBy>("end");
  const [tax, setTax] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [sort, setSort] = useState<Col | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  const { from, to } = range.range;
  const params = { basis, by, from: from ?? "", to: to ?? "", tax: tax || undefined, search: search || undefined };
  const ready = canView && !range.error && !!from && !!to;
  const q = useTaxReport(params, ready);

  // A new question starts on its first page — reset while rendering, not in an effect.
  const key = JSON.stringify(params);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (page !== 1) setPage(1);
  }

  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    if (!sort) return all;
    const sign = dir === "asc" ? 1 : -1;
    return [...all].sort((a, b) => {
      const va = a[sort as keyof TaxReportRow];
      const vb = b[sort as keyof TaxReportRow];
      return sign * (typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? "")));
    });
  }, [q.data, sort, dir]);

  if (denied("reports", "view") || denied("financials", "view")) return <NoAccess what="the tax report" />;

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const onSort = (id: Col) => {
    if (sort === id) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(id);
      setDir("asc");
    }
  };
  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportTaxReport(params);
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the report"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Tax report</h1>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeControl presets={TAX_DATE_PRESETS} state={range} />
          {basis === "accrual" ? (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              By:
              <select
                aria-label="By"
                className="h-9 rounded-md border bg-transparent px-2 text-sm text-foreground"
                value={by}
                onChange={(e) => setBy(e.target.value as TaxReportBy)}
              >
                {TAX_REPORT_BY.map((b) => (
                  <option key={b} value={b}>
                    {TAX_REPORT_BY_LABELS[b]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div role="tablist" aria-label="Tax basis" className="flex w-fit rounded-md border p-0.5">
          {(["accrual", "paid"] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={basis === b}
              onClick={() => setBasis(b)}
              className={cn(
                "h-7 rounded px-4 text-xs font-medium transition-colors",
                basis === b ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {b === "accrual" ? "Accrual" : "Paid"}
            </button>
          ))}
        </div>

        {range.error ? (
          <p role="alert" className="text-sm text-destructive">
            {range.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="tax-kpi">
            {q.isLoading ? "—" : money(q.data?.totalAmount)}
          </span>
          <span className="text-sm text-muted-foreground">{KPI[basis]}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Tax to show"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          >
            <option value="">All taxes</option>
            {(q.data?.taxes ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {t.name} ({t.rate.toFixed(2)}%)
              </option>
            ))}
          </select>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Search" aria-label="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <span className="flex-1" />
          <ExportButton busy={exporting} disabled={!ready} onClick={() => void runExport()} />
        </div>

        {q.isLoading && ready ? (
          <div role="status" aria-label="Loading the tax report" className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>{getApiErrorMessage(q.error, "Couldn't load the tax report")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div className={cn("overflow-x-auto border", q.isPlaceholderData && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {COLUMNS[basis].map((c) => (
                      <SortHead key={c.id} id={c.id} label={c.label} sort={sort ?? ("" as Col)} dir={dir} onSort={onSort} right={c.right} />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.rate.toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.amount)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{money(r.taxableAmount)}</TableCell>
                      {basis === "accrual" ? (
                        <TableCell className={cn("text-right font-mono tabular-nums", (r.nonTaxableAmount ?? 0) < 0 && "text-destructive")}>
                          {money(r.nonTaxableAmount)}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">{r.jobs.toLocaleString("en-US")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {q.data && rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                  <Percent className="size-6" />
                  <p className="text-sm">No taxed jobs in this period.</p>
                </div>
              ) : null}
            </div>
            <ReportFooter
              page={page}
              pageSize={pageSize}
              total={rows.length}
              shown={pageRows.length}
              onPage={setPage}
              onPageSize={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
