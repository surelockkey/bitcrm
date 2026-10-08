"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  INVOICE_DAYS_DUE,
  INVOICE_DAYS_DUE_LABELS,
  invoiceDiscountPercent,
  invoiceReportFigures,
  type InvoiceReportRow,
} from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { heldPager, useHeldView } from "@/features/billing/use-held-view";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { formatMoney } from "@/features/billing/lib";
import { isPartiallyPaid } from "@/features/payments/lib";
import { PartiallyPaidBadge } from "@/features/payments/components/payment-status-badge";
import { formatYmd } from "@/features/billing/dates";
import { NoAccess } from "@/features/billing/components/list-bits";
import { exportInvoiceReport } from "@/features/reports/billing/api";
import { useInvoiceReport, useInvoiceReportCount, useInvoiceReportSummary } from "@/features/reports/billing/hooks";
import {
  DEFAULT_INVOICE_PRESET,
  INVOICE_DATE_PRESETS,
  downloadCsv,
  splitInvoiceFilters,
  workizDate,
  workizDateTime,
  type InvoiceFilterKey,
  type InvoiceReportParams,
} from "@/features/reports/billing/lib";
import { DateRangeControl, ExportButton, ReportCard, money, useReportRange } from "@/features/reports/billing/components/report-bits";
import { FilterResults, type FilterGroup } from "@/features/reports/billing/components/filter-results";
import { createInvoice } from "../api";
import { useCreateInvoice, useJobsNeedingInvoice } from "../hooks";
import { runSequentially } from "../lib";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { invoiceHref } from "@/features/billing/components/client-documents";

type View = "invoices" | "needs";

/** One column of a list on this page: what it is called and how wide it starts. */
interface Col {
  id: string;
  label: string;
  width: number;
  /** Money and counts read right-aligned. */
  right?: boolean;
}

/**
 * The invoice list's columns — Workiz's Invoices report, in its order — with
 * the width each starts at.
 *
 * `table-fixed` on purpose: the client name comes from its own contacts
 * request and lands a frame after the rows, and under auto layout the whole
 * grid re-measures when it does. Declared once — the colgroup and the headers
 * are both built from here, and the reader's own widths are remembered under
 * `invoices`, the same name the page size is saved under.
 */
const INVOICE_COLUMNS: Col[] = [
  { id: "number", label: "Invoice NO.", width: 110 },
  { id: "name", label: "Invoice Name", width: 140 },
  { id: "client", label: "Client", width: 220 },
  { id: "created", label: "Created", width: 190 },
  { id: "subtotal", label: "Subtotal", width: 110, right: true },
  { id: "tax", label: "Tax", width: 100, right: true },
  { id: "discount", label: "Discount", width: 90, right: true },
  { id: "total", label: "Amount", width: 110, right: true },
  { id: "balance", label: "Due", width: 110, right: true },
  { id: "status", label: "Status", width: 190 },
  { id: "job", label: "Job", width: 100 },
  { id: "jobName", label: "Job name", width: 120 },
];

const widthsOf = (columns: Col[]): Record<string, number> =>
  Object.fromEntries(columns.map((c) => [c.id, c.width]));

const INVOICE_WIDTHS = widthsOf(INVOICE_COLUMNS);

/** Workiz's "Filter results" groups on this page (no QuickBooks / Service plan — neither is used here). */
const FILTER_GROUPS: FilterGroup<InvoiceFilterKey>[] = [
  {
    heading: "Status",
    options: [
      { key: "status:paid", label: "Paid" },
      { key: "status:partially_paid", label: "Partially paid" },
      { key: "status:due", label: "Due" },
      { key: "status:overdue", label: "Overdue" },
    ],
  },
  { heading: "Days due", options: INVOICE_DAYS_DUE.map((d) => ({ key: `days:${d}` as InvoiceFilterKey, label: INVOICE_DAYS_DUE_LABELS[d] })) },
  {
    heading: "Sent",
    options: [
      { key: "sent:sent", label: "Sent" },
      { key: "sent:unsent", label: "Unsent" },
    ],
  },
];
const FILTER_LABELS = new Map(FILTER_GROUPS.flatMap((g) => g.options.map((o) => [o.key, o.label] as const)));

/**
 * The needs-invoice list's columns. The checkbox and the button at the two
 * ends only exist for someone who may create an invoice, so the list is built
 * per reader rather than declared flat.
 */
function needsColumns(canCreate: boolean): Col[] {
  return [
    ...(canCreate ? [{ id: "select", label: "Select", width: 44 }] : []),
    { id: "job", label: "Job #", width: 110 },
    { id: "client", label: "Client", width: 240 },
    { id: "created", label: "Created", width: 130 },
    { id: "items", label: "Items", width: 90, right: true },
    { id: "total", label: "Total", width: 120, right: true },
    ...(canCreate ? [{ id: "create", label: "Create invoice", width: 160, right: true }] : []),
  ];
}

/**
 * Workiz's Invoices page (`/root/invoices`, also its Reports tile): All time by
 * default; four cards for the chosen created-date window — Due (every unpaid
 * one), Overdue, Unsent and, account-wide, Need invoices — each a filter;
 * "Filter results" (Status, Days due, Sent), search, Workiz's columns and its
 * CSV. The Needs invoice tab keeps the bulk "Create invoices".
 */
export function InvoicesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("invoices", "view");
  const [view, setView] = useState<View>("invoices");
  const range = useReportRange(DEFAULT_INVOICE_PRESET);
  const [selected, setSelected] = useState<InvoiceFilterKey[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [exporting, setExporting] = useState(false);
  const { from, to } = range.range;
  // `canView` still gates the queries — they must not fetch on a maybe. Until
  // the permissions answer, a disabled query is not an empty answer: the cards
  // would read "$0.00" and the list "No invoices match".
  const enabled = canView && !range.error;
  const summary = useInvoiceReportSummary({ from, to }, enabled);
  // Another date window keeps the numbers on the cards until its own are in.
  const cards = useHeldView(summary.data, [summary.data], !permsLoading && settled(summary));

  const params: Omit<InvoiceReportParams, "cursor"> = {
    ...(from && { from }),
    ...(to && { to }),
    ...splitInvoiceFilters(selected),
    ...(search && { search }),
  };
  const list = useInvoiceRows(params, enabled, !permsLoading);
  // The cards, the view switch with its number, the rows and the clients
  // beside them come up in one frame. The summary is the slowest answer, and
  // "Needs invoice · 29" widened the switch and slid the dates beside it.
  const ready = usePageReady(cards.shown && list.shown);

  // The refusal is the other way round: only once the answer is in.
  if (denied("invoices", "view")) return <NoAccess what="invoices" />;

  const s = cards.view;
  const only = (key: InvoiceFilterKey) => {
    setView("invoices");
    setSelected([key]);
  };
  const toggle = (key: InvoiceFilterKey) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportInvoiceReport(params);
      if (out.truncated) toast.warning?.(`Exported the first ${out.count.toLocaleString("en-US")} invoices — narrow the range for the rest.`);
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the invoices"));
    } finally {
      setExporting(false);
    }
  };
  const isOnly = (key: InvoiceFilterKey) => view === "invoices" && selected.length === 1 && selected[0] === key;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
        {/* Held invisible, at its height, until the page is up: the switch is
            drawn with its number rather than widening beside the dates. */}
        <div className={cn("ml-auto flex flex-wrap items-center gap-3", !ready && "invisible")}>
          <DateRangeControl presets={INVOICE_DATE_PRESETS} state={range} />
          <div role="tablist" aria-label="View" className="flex rounded-md border p-0.5">
            {(
              [
                ["invoices", "Invoices"],
                ["needs", `Needs invoice${s ? ` · ${s.needInvoices.count}` : ""}`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "h-7 rounded px-3 text-xs font-medium transition-colors",
                  view === v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {range.error ? (
          <p role="alert" className="text-sm text-destructive">
            {range.error}
          </p>
        ) : null}
        {ready ? (
          <>
            <div
              className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4", cards.held && "opacity-60")}
              aria-busy={cards.held || undefined}
            >
              <ReportCard
                value={money(s?.due.amount)}
                caption={`Due from ${s?.due.count ?? 0} invoices`}
                active={isOnly("status:due")}
                onClick={() => only("status:due")}
              />
              <ReportCard
                value={money(s?.overdue.amount)}
                caption={`Overdue from ${s?.overdue.count ?? 0} invoices`}
                border="border-l-red-600"
                active={isOnly("status:overdue")}
                onClick={() => only("status:overdue")}
              />
              <ReportCard
                value={`${s?.unsent.count ?? 0} invoices`}
                caption="Unsent"
                border="border-l-sky-500"
                active={isOnly("sent:unsent")}
                onClick={() => only("sent:unsent")}
              />
              <ReportCard
                value={`${s?.needInvoices.count ?? 0} jobs`}
                caption="Need invoices"
                border="border-l-amber-500"
                active={view === "needs"}
                onClick={() => setView("needs")}
              />
            </div>
            {view === "invoices" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <FilterResults groups={FILTER_GROUPS} selected={selected} onToggle={toggle} />
                  {selected.map((key) => (
                    <Badge key={key} variant="outline" className="gap-1 font-normal">
                      {FILTER_LABELS.get(key) ?? key}
                      <button type="button" aria-label={`Remove ${FILTER_LABELS.get(key) ?? key}`} onClick={() => toggle(key)}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  {selected.length ? (
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected([])}>
                      Clear
                    </Button>
                  ) : null}
                  <div className="relative w-full max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="h-9 pl-8" placeholder="Search invoice # or name" aria-label="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
                  </div>
                  <span className="flex-1" />
                  <ExportButton busy={exporting} disabled={!!range.error} onClick={() => void runExport()} />
                </div>
                <InvoicesTable list={list} />
              </>
            ) : (
              <NeedsInvoiceTable canCreate={can("invoices", "create")} />
            )}
          </>
        ) : (
          <InvoicesSkeleton />
        )}
      </div>
    </div>
  );
}

/** The page before its first frame: the four cards, the filters, the list. */
function InvoicesSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading invoices">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-18 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Rows have no identity of their own while there are none; one empty list keeps the held view still. */
const NO_ROWS: InvoiceReportRow[] = [];

/**
 * The list as the reader sees it: a page of rows, the clients printed beside
 * them (the name, and the email or phone under it) and the pager under them —
 * complete, or the previous complete one while the next is on its way.
 *
 * The clients are a second round trip that cannot start until the rows say
 * whose names to ask for; rows drawn before them grew a line when they
 * landed and pushed every row under them.
 */
function useInvoiceRows(params: Omit<InvoiceReportParams, "cursor">, enabled: boolean, permsIn: boolean) {
  const [pageSize, setPageSize] = usePageSize("invoices");
  const q = useInvoiceReport({ ...params, limit: pageSize }, enabled);
  const count = useInvoiceReportCount(params, enabled);
  const pager = usePager(pagedSource(q, (page: { items: InvoiceReportRow[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ params, pageSize }),
  });
  const rows: InvoiceReportRow[] = pager.items.length ? pager.items : NO_ROWS;
  const contacts = useContactsByIds(rows.map((r) => r.contactId));
  const complete = permsIn && settled(q) && settled(count) && !contacts.isLoading;
  const held = useHeldView(
    { rows, contacts: contacts.map, pager, error: q.error },
    [rows, contacts.map, pager.page, pager.total, q.error],
    complete,
  );
  return { ...held, pageSize, setPageSize, retry: () => void q.refetch() };
}

function InvoicesTable({ list }: { list: ReturnType<typeof useInvoiceRows> }) {
  const router = useRouter();
  const { rows, contacts, pager, error } = list.view;
  // The reader's own widths for this list; the declarations only set the start.
  const { widthOf, setWidth, reset } = useColumnWidths("invoices", INVOICE_WIDTHS);

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load invoices")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={list.retry}>Try again</Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileText className="size-6" />
        <p className="text-sm">No invoices match these filters.</p>
      </div>
    );
  }

  const open = (inv: InvoiceReportRow) => router.push(invoiceHref(inv));

  return (
    // The previous set, dimmed, while the next one is on its way.
    <div className={cn("space-y-3", list.held && "opacity-60")} aria-busy={list.held || undefined}>
      <div className="overflow-x-auto border">
        <Table className="table-fixed">
          <colgroup>
            {INVOICE_COLUMNS.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id) }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {INVOICE_COLUMNS.map((c) => (
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
            {rows.map((inv) => {
              const c = contacts.get(inv.contactId);
              // Workiz's figures: Subtotal without the card fee, Amount with the tip,
              // a cent or less owed shown as Paid / $0.00. The stored totals are untouched.
              const f = inv.report ?? invoiceReportFigures(inv);
              // Workiz shows the email under the name, else the phone (masked unless the reader may see numbers).
              const under = c?.emails?.[0] ?? c?.phones?.[0];
              return (
                <TableRow
                  key={inv.id}
                  tabIndex={0}
                  className="cursor-pointer align-top"
                  onClick={() => open(inv)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open(inv);
                  }}
                >
                  {/* Under `table-fixed` a cell that does not clip spills over
                      the next column instead of widening its own. */}
                  <TableCell className="truncate font-mono font-medium">#{inv.number}</TableCell>
                  <TableCell className="truncate">{inv.workizName ?? ""}</TableCell>
                  <TableCell className="overflow-hidden">
                    <span className="block truncate">{c ? contactName(c) : "—"}</span>
                    {under ? <span className="block truncate text-xs text-muted-foreground">{under}</span> : null}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground tabular-nums" title={formatYmd(inv.invoiceDate || inv.createdAt)}>
                    {workizDateTime(inv.createdAt)}
                  </TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(f.subtotal)}</TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(f.tax)}</TableCell>
                  <TableCell className="truncate text-right tabular-nums">{invoiceDiscountPercent(inv.totals).toFixed(2)}%</TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums" title={f.tip ? `Includes a ${formatMoney(f.tip)} tip` : undefined}>
                    {formatMoney(f.amount)}
                  </TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(f.balance)}</TableCell>
                  <TableCell className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-1">
                      <InvoiceStatusBadge status={f.status} />
                      {f.status !== "paid" && isPartiallyPaid(inv.totals?.amountPaid ?? 0, f.balance) ? <PartiallyPaidBadge /> : null}
                    </div>
                    <span className="block truncate text-xs text-muted-foreground">
                      {inv.sentAt ? `sent on ${workizDate(inv.sentAt)}` : "Not sent"}
                    </span>
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    {inv.dealId ? (
                      <Link
                        href={`/deals/${inv.dealId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate font-mono text-wz-link hover:underline"
                      >
                        {inv.number}
                      </Link>
                    ) : (
                      // A client invoice: no job behind it.
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground" />
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

function NeedsInvoiceTable({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const q = useJobsNeedingInvoice();
  const createOne = useCreateInvoice();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const jobs = useMemo(() => q.data ?? [], [q.data]);
  const columns = useMemo(() => needsColumns(canCreate), [canCreate]);
  const defaults = useMemo(() => widthsOf(columns), [columns]);
  // Saved apart from the invoice list above: a different set of columns, and
  // widening "Client" here should not narrow it there.
  const { widthOf, setWidth, reset } = useColumnWidths("invoices-needs", defaults);
  const visibleSelected = jobs.filter((j) => selected.has(j.id)).map((j) => j.id);
  const allChecked = jobs.length > 0 && visibleSelected.length === jobs.length;

  const bulkCreate = async () => {
    const ids = visibleSelected;
    if (!ids.length) return;
    setBulkRunning(true);
    const tid = toast.loading(`Creating invoices… 0/${ids.length}`);
    const { succeeded, failed } = await runSequentially(ids, createInvoice, (done, total) =>
      toast.loading(`Creating invoices… ${done}/${total}`, { id: tid }),
    );
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
    setSelected(new Set(failed.map((f) => f.id)));
    setBulkRunning(false);
    if (failed.length === 0) {
      toast.success(`Created ${succeeded.length} invoice${succeeded.length === 1 ? "" : "s"}`, { id: tid });
    } else {
      toast.error(
        `Created ${succeeded.length}, ${failed.length} failed: ${getApiErrorMessage(failed[0].error)}`,
        { id: tid },
      );
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load jobs")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileText className="size-6" />
        <p className="text-sm">Every job with items has an invoice.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canCreate ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {visibleSelected.length ? `${visibleSelected.length} selected` : "Select jobs to invoice in bulk"}
          </p>
          <Button
            variant="brand"
            size="sm"
            className="ml-auto"
            disabled={!visibleSelected.length || bulkRunning}
            onClick={bulkCreate}
          >
            {bulkRunning ? <Loader2 className="animate-spin" /> : <FileText />}
            Create invoices{visibleSelected.length ? ` (${visibleSelected.length})` : ""}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto border">
        <Table className="table-fixed">
          <colgroup>
            {columns.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id) }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <ResizableHead
                  key={c.id}
                  columnId={c.id}
                  label={c.label}
                  width={widthOf(c.id)}
                  onResize={(px) => setWidth(c.id, px)}
                  onReset={reset}
                  className={c.right ? "text-right" : undefined}
                >
                  {c.id === "select" ? (
                    <Checkbox
                      aria-label="Select all jobs"
                      checked={allChecked ? true : visibleSelected.length ? "indeterminate" : false}
                      onCheckedChange={(v) => setSelected(v === true ? new Set(jobs.map((j) => j.id)) : new Set())}
                    />
                  ) : c.id === "create" ? (
                    // The button column is titled for the screen reader and
                    // for the handle beside it, not on screen.
                    <span className="sr-only">{c.label}</span>
                  ) : (
                    c.label
                  )}
                </ResizableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                {canCreate ? (
                  <TableCell className="overflow-hidden">
                    <Checkbox
                      aria-label={`Select job ${j.dealNumber}`}
                      checked={selected.has(j.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(j.id);
                          else next.delete(j.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                ) : null}
                <TableCell className="truncate">
                  <Link href={`/deals/${j.id}?tab=items`} className="font-mono font-medium text-wz-link hover:underline">
                    #{j.dealNumber}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{j.clientName || "—"}</TableCell>
                <TableCell className="truncate text-muted-foreground tabular-nums">{formatYmd(j.createdAt)}</TableCell>
                <TableCell className="truncate text-right tabular-nums">{j.itemCount}</TableCell>
                <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(j.total)}</TableCell>
                {canCreate ? (
                  <TableCell className="overflow-hidden text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={bulkRunning || (createOne.isPending && createOne.variables === j.id)}
                      onClick={() => createOne.mutate(j.id)}
                    >
                      {createOne.isPending && createOne.variables === j.id ? <Loader2 className="animate-spin" /> : null}
                      Create invoice
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
