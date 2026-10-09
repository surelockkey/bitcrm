"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invoiceDiscountPercent, invoiceReportFigures, type Contact, type InvoiceReportRow } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResizableHead } from "@/components/ui/resizable-head";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzGroupedFilter } from "@/components/workiz/grouped-filter";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { heldPager, useHeldView } from "@/features/billing/use-held-view";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { clientSubline } from "@/features/clients/clients-list";
import { contactName, extensionOf, formatPhoneWithExtension } from "@/features/clients/lib";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { NoAccess } from "@/features/billing/components/list-bits";
import { invoiceHref } from "@/features/billing/components/client-documents";
import {
  DEFAULT_REPORT_PAGE_SIZE,
  PAYMENTS_REPORT_PRESETS,
  REPORT_PAGE_SIZES,
  paymentsCustomCheck,
  paymentsRangeText,
  paymentsReportRange,
  type PaymentsReportPreset,
} from "@/features/payments/report";
import { viewerToday } from "@/features/reports/jobs/lib";
import { exportInvoiceReport } from "@/features/reports/billing/api";
import { useInvoiceReport, useInvoiceReportCount, useInvoiceReportSummary } from "@/features/reports/billing/hooks";
import { downloadCsv, workizDateTime, type InvoiceReportParams } from "@/features/reports/billing/lib";
import { money } from "@/features/reports/billing/components/report-bits";
import { createInvoice } from "../api";
import { useCreateInvoice, useJobsNeedingInvoice } from "../hooks";
import { runSequentially } from "../lib";
import {
  INVOICE_CARDS,
  INVOICE_FILTER_GROUPS,
  INVOICE_GRID_COLUMNS,
  invoiceCardFilter,
  invoiceCardText,
  invoiceFilterQuery,
  invoiceStatusCell,
  type InvoiceCard,
  type InvoiceColumnId,
  type InvoiceFilterValue,
} from "../invoices-list";

/** Workiz opens the page on every invoice there is. */
const DEFAULT_PRESET: Exclude<PaymentsReportPreset, "custom"> = "all_time";

/** The reader's widths are kept apart from the old shadcn list's, which started from other widths. */
const INVOICE_WIDTHS = Object.fromEntries(INVOICE_GRID_COLUMNS.map((c) => [c.id, c.width])) as Record<InvoiceColumnId, number>;

/**
 * Workiz's Invoices page (`/root/invoices/`, also its Reports tile), drawn as
 * Workiz draws it (pg_invoices_wz_*): no title — four cards (Due, Overdue,
 * Unsent, Need invoices) whose click is a filter; "Filter results" (Status,
 * Days due, Sent) with the date box at the right; the grey strip (Search, the
 * page size, Export); the react-table grid with the pager inside it. All time
 * by default; the cards follow the chosen created-date window, as Workiz's do.
 *
 * Workiz's bulk row (Send invoice / Send reminder / Mark sent / More) and its
 * row checkboxes are left out — BitCRM has no bulk invoice actions — but the
 * row's room is kept, so the strip and the grid sit where Workiz's do. Need
 * invoices opens Workiz's "Jobs" window, where BitCRM creates invoices one
 * job at a time or in bulk.
 */
export function InvoicesPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("invoices", "view");

  // The date box counts its presets from the viewer's own clock, as Workiz's
  // datepicker does (rep_payments, checked live). A Custom range Workiz would
  // refuse — or one still missing a day — keeps asking for the last good one.
  const [today] = useState(() => viewerToday());
  const [range, setRange] = useState<WzDateRange>(() => ({ preset: DEFAULT_PRESET, ...paymentsReportRange(DEFAULT_PRESET, today) }));
  const custom = paymentsCustomCheck(range);
  const [applied, setApplied] = useState(range);
  if (custom.usable && (applied.from !== range.from || applied.to !== range.to)) setApplied(range);
  const from = applied.from || undefined;
  const to = applied.to || undefined;

  const [filter, setFilter] = useState<InvoiceFilterValue>({});
  // Workiz keeps the last card clicked orange until another is clicked
  // (`activeSection`), whatever the filter does after.
  const [activeCard, setActiveCard] = useState<InvoiceCard | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [exporting, setExporting] = useState(false);

  // `canView` still gates the queries — they must not fetch on a maybe. Until
  // the permissions answer, a disabled query is not an empty answer: the cards
  // would read "$0.00" and the grid "No Records Found".
  const enabled = canView;
  const summary = useInvoiceReportSummary({ from, to }, enabled);
  // Another date window keeps the numbers on the cards until its own are in.
  const cards = useHeldView(summary.data, [summary.data], !permsLoading && settled(summary));

  const params: Omit<InvoiceReportParams, "cursor"> = {
    ...(from && { from }),
    ...(to && { to }),
    ...invoiceFilterQuery(filter),
    ...(search && { search }),
  };
  const list = useInvoiceRows(params, enabled, !permsLoading);
  // The cards, the rows and the clients beside them come up in one frame.
  const ready = usePageReady(cards.shown && list.shown);

  // The refusal is the other way round: only once the answer is in.
  if (denied("invoices", "view")) return <NoAccess what="invoices" />;

  const pickCard = (card: InvoiceCard) => {
    setActiveCard(card);
    const chip = invoiceCardFilter(card);
    if (chip) setFilter(chip);
    else setJobsOpen(true);
  };
  const open = (inv: InvoiceReportRow, e: WzRowOpenEvent) => {
    const href = invoiceHref(inv);
    const newTab = e.metaKey || e.ctrlKey || ("button" in e && e.button === 1);
    if (newTab) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };
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

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="invoices-scroller">
      {/* The cards (pg_invoices_wz_01_default): 317×81, 31px apart, 20px in, 34px under the breadcrumbs. */}
      <div
        className={cn("grid shrink-0 grid-cols-2 gap-[31px] px-5 pt-[34px] xl:grid-cols-4", cards.held && "opacity-60")}
        aria-busy={cards.held || undefined}
      >
        {ready
          ? INVOICE_CARDS.map((card) => {
              const text = invoiceCardText(card, cards.view);
              const on = activeCard === card;
              return (
                <WzKpiCard
                  key={card}
                  value={text.value}
                  caption={text.caption}
                  label={text.label}
                  // Workiz's `left-orange`: the picked card's rule turns orange
                  // and the card stays white (no grey fill, unlike Aging's).
                  tone={on ? "orange" : "ink"}
                  selected={on}
                  onSelect={() => pickCard(card)}
                  className="bg-background"
                />
              );
            })
          : INVOICE_CARDS.map((card) => <WzKpiCardSkeleton key={card} />)}
      </div>

      {/* Filter results and the date box, 28px under the cards, 20px apart, 20px
          off both edges. The left column keeps the height of Workiz's bulk row
          under the filter (left out: no bulk actions), so the strip sits at
          Workiz's y — and a Custom range pushes it down as Workiz's does. */}
      <div className="flex shrink-0 items-start gap-5 px-5 pt-7 pb-5">
        <div className="min-h-[92px] min-w-0 flex-1">
          <WzGroupedFilter
            placeholder="Filter results"
            groups={INVOICE_FILTER_GROUPS}
            value={filter}
            onChange={(next) => setFilter(next as InvoiceFilterValue)}
          />
        </div>
        <div className="pb-[11px]">
          <WzDateRangePicker
            presets={PAYMENTS_REPORT_PRESETS}
            value={range}
            onChange={setRange}
            rangeOf={(id) => (id === "custom" ? null : paymentsReportRange(id as Exclude<PaymentsReportPreset, "custom">, today))}
            rangeText={(v) => (v.preset === "all_time" ? paymentsRangeText(v) : undefined)}
            customError={custom.error}
            calendar={{ today }}
          />
        </div>
      </div>

      {/* The grey strip: Search; the page size and Export at the right. Workiz has no Fields here. */}
      <WzListToolbar className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} maxLength={100} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={list.pageSize} sizes={REPORT_PAGE_SIZES} onChange={list.setPageSize} />
          <WzToolbarButton onClick={() => void runExport()} disabled={exporting || !ready}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <InvoicesGrid list={list} ready={ready} onOpen={open} />

      <Dialog open={jobsOpen} onOpenChange={setJobsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Jobs</DialogTitle>
          </DialogHeader>
          {jobsOpen ? <NeedsInvoiceTable canCreate={can("invoices", "create")} /> : null}
        </DialogContent>
      </Dialog>
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
  const [pageSize, setPageSize] = usePageSize("invoices", { sizes: REPORT_PAGE_SIZES, fallback: DEFAULT_REPORT_PAGE_SIZE });
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

/** A value alone in its cell: one line, cut at the cell's edge as react-table cuts it. */
const Text = ({ children, title }: { children?: React.ReactNode; title?: string }) => (
  <span className="block truncate" title={title}>
    {children}
  </span>
);

/** Links inside a row open their own page, not the row's. */
const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Workiz's ClientTableCell: the name (h5), then the email (small) or the
 * phone as a blue call link. Blocks, so a long name runs into the cell's
 * padding and is cut at its edge without "…" (pg_invoices_wz_10_card_overdue).
 */
function ClientCell({ contact }: { contact: Contact | undefined }) {
  if (!contact) return null;
  const sub = clientSubline(contact);
  return (
    <>
      <div className="text-base leading-6 tracking-[0.2px] whitespace-nowrap text-foreground">{contactName(contact)}</div>
      {sub?.kind === "email" ? (
        <div className="text-xs leading-[18px] whitespace-nowrap text-foreground">{sub.text}</div>
      ) : sub?.kind === "phone" ? (
        <a href={`tel:${sub.phone}`} onClick={stop} className="table text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline">
          {formatPhoneWithExtension(sub.phone, extensionOf(contact, sub.phone))}
        </a>
      ) : null}
    </>
  );
}

function invoiceColumns(contacts: Map<string, Contact>): WzReportColumn<InvoiceReportRow>[] {
  // Workiz's figures: Subtotal without the card fee, Amount with the tip, a
  // cent or less owed shown as Paid / $0.00. The stored totals are untouched.
  const figures = (inv: InvoiceReportRow) => inv.report ?? invoiceReportFigures(inv);
  const cell: Record<InvoiceColumnId, (inv: InvoiceReportRow) => React.ReactNode> = {
    // Ink, as Workiz's (`/root/invoice/<uuid>`); the row opens the same place.
    number: (inv) => (
      <Link href={invoiceHref(inv)} onClick={stop} className="block truncate text-foreground no-underline">
        {inv.number}
      </Link>
    ),
    name: (inv) => <Text>{inv.workizName ?? ""}</Text>,
    client: (inv) => <ClientCell contact={contacts.get(inv.contactId)} />,
    created: (inv) => <Text>{workizDateTime(inv.createdAt)}</Text>,
    subtotal: (inv) => <Text>{money(figures(inv).subtotal)}</Text>,
    tax: (inv) => <Text>{money(figures(inv).tax)}</Text>,
    discount: (inv) => <Text>{invoiceDiscountPercent(inv.totals).toFixed(2)}%</Text>,
    total: (inv) => {
      const f = figures(inv);
      return <Text title={f.tip ? `Includes a ${formatMoney(f.tip)} tip` : undefined}>{money(f.amount)}</Text>;
    },
    balance: (inv) => <Text>{money(figures(inv).balance)}</Text>,
    // Workiz's `_invStatusCell`: the coloured word (1.1em, 5px under it), then
    // when it was sent in #999 — floated blocks, so they run into the cell's
    // padding and are cut at its edge without "…" ("sent on Thu").
    status: (inv) => {
      const s = invoiceStatusCell(figures(inv), inv.totals, inv.sentAt);
      return (
        <>
          <span className={cn("mb-[5px] block text-[15.4px] leading-4 whitespace-nowrap", s.className)}>{s.word}</span>
          {s.partial ? <span className="block text-sm leading-4 whitespace-nowrap text-wz-caption">Partially paid</span> : null}
          <span className="block text-sm leading-4 whitespace-nowrap text-wz-caption">{s.sent}</span>
        </>
      );
    },
    // A client invoice has no job: the cell stays empty, as Workiz's blanks do.
    job: (inv) =>
      inv.dealId ? (
        <Link href={`/deals/${inv.dealId}`} onClick={stop} className="block truncate text-foreground no-underline">
          {inv.number}
        </Link>
      ) : null,
    jobName: () => null,
  };
  return INVOICE_GRID_COLUMNS.map((c) => ({ id: c.id, label: c.label, cell: cell[c.id] }));
}

function InvoicesGrid({
  list,
  ready,
  onOpen,
}: {
  list: ReturnType<typeof useInvoiceRows>;
  ready: boolean;
  onOpen: (inv: InvoiceReportRow, e: WzRowOpenEvent) => void;
}) {
  const { rows, contacts, pager, error } = list.view;
  // The reader's own widths for this grid; the declarations only set the start.
  const { widthOf, setWidth, reset } = useColumnWidths("invoices-list", INVOICE_WIDTHS);
  const columns = useMemo(() => invoiceColumns(contacts), [contacts]);

  if (ready && error) {
    return (
      <div className="border border-wz-frame px-5 py-10 text-center text-sm">
        <p role="alert">{getApiErrorMessage(error, "Couldn't load invoices")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={list.retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <WzReportGrid
      aria-label="Invoices"
      className="shrink-0"
      columns={columns}
      rows={ready ? rows : NO_ROWS}
      rowKey={(inv) => inv.id}
      // Workiz's default order, newest first, carries the bar; the server
      // pages that one order only, so the headers do not re-sort.
      sort={{ column: "created", dir: "desc" }}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={onOpen}
      loading={!ready}
      // The previous set, faded, while the next one is on its way.
      busy={list.held}
      footer={ready ? <WzPager pager={list.held ? heldPager(pager) : pager} plainNumbers /> : null}
    />
  );
}

/** The jobs window's columns; the checkbox and the button only for someone who may create invoices. */
interface NeedsCol {
  id: string;
  label: string;
  width: number;
  right?: boolean;
}

function needsColumns(canCreate: boolean): NeedsCol[] {
  return [
    // Together inside the window's 852px, so nothing scrolls sideways.
    ...(canCreate ? [{ id: "select", label: "Select", width: 44 }] : []),
    { id: "job", label: "Job NO.", width: 100 },
    { id: "client", label: "Client", width: 220 },
    { id: "created", label: "Date", width: 120 },
    { id: "items", label: "Items", width: 70, right: true },
    { id: "total", label: "Amount", width: 110, right: true },
    ...(canCreate ? [{ id: "create", label: "Generate invoice", width: 170, right: true }] : []),
  ];
}

/**
 * Workiz's "Jobs" window behind Need invoices: the jobs with items and no
 * invoice, each with "Generate invoice". Ours also takes a selection and
 * creates them in bulk, one job at a time.
 */
function NeedsInvoiceTable({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const q = useJobsNeedingInvoice();
  const createOne = useCreateInvoice();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const jobs = useMemo(() => q.data ?? [], [q.data]);
  const columns = useMemo(() => needsColumns(canCreate), [canCreate]);
  const defaults = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.width])), [columns]);
  // Saved apart from the invoice grid: a different set of columns.
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
      toast.error(`Created ${succeeded.length}, ${failed.length} failed: ${getApiErrorMessage(failed[0].error)}`, { id: tid });
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="p-8 text-center text-sm">
        <p role="alert">{getApiErrorMessage(q.error, "Couldn't load jobs")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (jobs.length === 0) return <p className="py-10 text-center text-sm text-wz-caption">Every job with items has an invoice.</p>;

  return (
    // `min-w-0`: the dialog is a grid, and a grid item would otherwise grow to the table.
    <div className="min-w-0 space-y-3">
      {canCreate ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-wz-caption">
            {visibleSelected.length ? `${visibleSelected.length} selected` : "Select jobs to invoice in bulk"}
          </p>
          <Button className="ml-auto" size="sm" disabled={!visibleSelected.length || bulkRunning} onClick={bulkCreate}>
            {bulkRunning ? <Loader2 className="animate-spin" /> : <FileText />}
            Create invoices{visibleSelected.length ? ` (${visibleSelected.length})` : ""}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto border border-wz-frame">
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
                    // The button column is titled for the screen reader and the handle beside it, not on screen.
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
                  <Link href={`/deals/${j.id}?tab=items`} className="text-foreground no-underline">
                    {j.dealNumber}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{j.clientName || ""}</TableCell>
                <TableCell className="truncate">{formatYmd(j.createdAt)}</TableCell>
                <TableCell className="truncate text-right">{j.itemCount}</TableCell>
                <TableCell className="truncate text-right">{money(j.total)}</TableCell>
                {canCreate ? (
                  <TableCell className="overflow-hidden text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={bulkRunning || (createOne.isPending && createOne.variables === j.id)}
                      onClick={() => createOne.mutate(j.id)}
                    >
                      {createOne.isPending && createOne.variables === j.id ? <Loader2 className="animate-spin" /> : null}
                      Generate invoice
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
