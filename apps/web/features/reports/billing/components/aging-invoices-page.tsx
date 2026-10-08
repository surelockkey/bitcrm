"use client";

import { useState } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket, type AgingSort } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { DEFAULT_REPORT_PAGE_SIZE } from "@/features/payments/report";
import { exportAging } from "../api";
import { useAging } from "../hooks";
import { AGING_TONES, downloadCsv, workizDate } from "../lib";
import { ExportButton, ReportCard, ReportFooter, SortHead, money } from "./report-bits";

const COLUMNS: { id: AgingSort; label: string; right?: boolean }[] = [
  { id: "number", label: "Invoice No." },
  { id: "name", label: "Invoice Name" },
  { id: "client", label: "Client name" },
  { id: "total", label: "Total", right: true },
  { id: "balance", label: "Balance", right: true },
  { id: "dueDate", label: "Due on" },
  { id: "createdAt", label: "Created" },
  { id: "daysLate", label: "Days Late", right: true },
];

/**
 * Workiz Reports → Aging invoices (`/root/agingInvoices`): always "as of
 * today", no date picker, no filters — five cards that ARE the filter. The
 * first is every unpaid invoice (not yet due included), the other four the
 * overdue ones by Days Late. Server-sorted on any column (oldest debt first
 * by default), paged, exported as Workiz's CSV.
 */
export function AgingInvoicesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("invoices", "view");
  const [bucket, setBucket] = useState<AgingBucket>("all");
  const [sort, setSort] = useState<AgingSort>("daysLate");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);
  const q = useAging({ bucket, sort, dir, page, pageSize }, canView);
  // The cards were drawn holding "—" and the figures came a beat later — a
  // right-aligned "$235,074.06" starts far left of a "—", so every one slid —
  // and the index note landed above the cards. They all come with the report.
  // (Until the role is read the report is not asked for, which is not an answer.)
  const ready = usePageReady(!permsLoading && settled(q));

  if (denied("invoices", "view")) return <NoAccess what="invoices" />;

  const r = q.data;
  const pick = (b: AgingBucket) => {
    setBucket(b);
    setPage(1);
  };
  const onSort = (id: AgingSort) => {
    if (id === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(id);
      setDir(id === "daysLate" || id === "balance" || id === "total" ? "desc" : "asc");
    }
    setPage(1);
  };
  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportAging({ bucket, sort, dir });
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
        <h1 className="text-lg font-semibold tracking-tight">Aging invoices</h1>
        {r ? <span className="text-xs text-muted-foreground">As of {workizDate(r.asOf)}</span> : null}
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {!ready ? (
          // The cards and the table, while the report is on its way.
          <div role="status" aria-label="Loading invoices" className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <Skeleton key={b} className="h-[4.5rem] rounded-lg" />
              ))}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {r && !r.indexReady ? (
              <p role="status" className="text-xs text-muted-foreground">
                The unpaid-invoice index is not built on this environment yet — figures come from a full read and are slower.
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {AGING_BUCKETS.map((b) => {
                const card = r?.cards[b];
                const caption =
                  b === "all" ? `${(card?.count ?? 0).toLocaleString("en-US")} ${AGING_BUCKET_LABELS.all}` : `${AGING_BUCKET_LABELS[b]} (${card?.count ?? 0})`;
                return (
                  <ReportCard
                    key={b}
                    value={money(card?.amount)}
                    caption={caption}
                    border={AGING_TONES[b]}
                    active={bucket === b}
                    loading={q.isLoading}
                    onClick={() => pick(b)}
                  />
                );
              })}
            </div>

            <div className="flex items-center justify-end">
              <ExportButton busy={exporting} onClick={() => void runExport()} />
            </div>

            {q.isLoading ? (
              <div role="status" aria-label="Loading invoices" className="space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : q.isError ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <p>{getApiErrorMessage(q.error, "Couldn't load the report")}</p>
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
                        {COLUMNS.map((c) => (
                          <SortHead key={c.id} id={c.id} label={c.label} sort={sort} dir={dir} onSort={onSort} right={c.right} />
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(r?.items ?? []).map((row) => (
                        <TableRow key={row.invoiceId} className="align-top">
                          <TableCell className="whitespace-nowrap font-mono">
                            <Link
                              // A client invoice (no job) lives on its own page.
                              href={row.dealId ? `/deals/${row.dealId}?tab=invoice` : `/invoices/${row.invoiceId}`}
                              className="text-wz-link hover:underline"
                            >
                              {row.number}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-48 truncate">{row.name ?? ""}</TableCell>
                          <TableCell className="max-w-56">
                            <Link href={`/contacts/${row.contactId}`} className="block truncate hover:underline">
                              {row.clientName ?? "—"}
                            </Link>
                            {row.clientEmail || row.clientPhone ? (
                              <span className="block truncate text-xs text-muted-foreground">{row.clientEmail ?? row.clientPhone}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(row.total)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{money(row.balance)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{workizDate(row.dueDate)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{workizDate(row.createdAt)}</TableCell>
                          <TableCell className={cn("whitespace-nowrap text-right tabular-nums", row.daysLate >= 90 && "text-red-700 dark:text-red-400")}>
                            {row.daysLate}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {r && r.items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                      <ReceiptText className="size-6" />
                      <p className="text-sm">No unpaid invoices here.</p>
                    </div>
                  ) : null}
                </div>
                <ReportFooter
                  page={page}
                  pageSize={pageSize}
                  total={r?.total ?? 0}
                  shown={r?.items.length ?? 0}
                  onPage={setPage}
                  onPageSize={(s) => {
                    setPageSize(s);
                    setPage(1);
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
