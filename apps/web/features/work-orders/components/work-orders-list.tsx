"use client";

import { useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import type { Company, WorkOrder, WorkOrderStatus } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { WzGroupedFilter } from "@/components/workiz/grouped-filter";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import { localGridView, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useCompanies } from "@/features/clients/hooks";
import { useDealsByIds } from "@/features/deals/hooks";
import { DEFAULT_REPORT_PAGE_SIZE, REPORT_PAGE_SIZES } from "@/features/payments/report";
import { money } from "@/features/reports/billing/components/report-bits";
import { downloadCsv, workizDate } from "@/features/reports/billing/lib";
import { useWorkOrders } from "../hooks";
import {
  WORK_ORDER_STATUSES,
  filterWorkOrders,
  workOrderCardText,
  workOrderFilterGroups,
  workOrderHref,
  workOrderStats,
  workOrderStatusLabel,
  workOrdersCsv,
  type WorkOrderFilterValue,
} from "../lib";
import { CreateWorkOrderDialog } from "./create-work-order-dialog";

/** The grid's columns, in order, with the widths they start at (the reader's own are kept). */
const COLUMNS = [
  { id: "woNumber", label: "WO NO.", width: 180 },
  { id: "client", label: "Client", width: 260 },
  { id: "date", label: "Date", width: 170 },
  { id: "amount", label: "Amount", width: 130 },
  { id: "status", label: "Status", width: 130 },
  { id: "job", label: "Job", width: 120 },
  { id: "description", label: "Description", width: 300 },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];

const WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width])) as Record<ColumnId, number>;

/** Newest first, as Workiz opens its lists. */
const DEFAULT_SORT: WzGridSort = { id: "date", dir: "desc" };

/** Links inside a row open their own page, not the row's. */
const stop = (e: MouseEvent) => e.stopPropagation();

/** A value alone in its cell: one line, cut at the cell's edge as react-table cuts it. */
const Text = ({ children }: { children?: React.ReactNode }) => <span className="block truncate">{children}</span>;

/**
 * Workiz has no list of work orders — a job's Actions → View Work Order opens
 * one. This BitCRM-only registry of Platinum clients' WOs is drawn as Workiz's
 * Estimates and Invoices lists are (uikit_wz_estimates, pg_invoices_wz_*):
 * no title — the status cards ("Open / 3 Worth $1,250.00") that ARE the
 * status filter; "Filter results" (Status, Client) with "+ Add New" at the
 * right; the grey strip (Search, the page size, Export); the react-table grid
 * with the pager inside its frame, "No Records Found" when nothing is left.
 * A row opens the work order's own view (Workiz's work order page).
 *
 * Every work order comes in one answer, so search, sort and pages are worked
 * out here (`localGridView`). The rows come up with their clients named and
 * their jobs numbered — one frame.
 */
export function WorkOrdersList() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("work_orders", "view");
  const seesJobs = can("deals", "view");

  const [filter, setFilter] = useState<WorkOrderFilterValue>({});
  // Workiz keeps the last card clicked orange until another is clicked.
  const [activeCard, setActiveCard] = useState<WorkOrderStatus | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [adding, setAdding] = useState(false);

  // The queries must not fetch on a maybe: until the permissions answer, `can` says no.
  const workOrdersQuery = useWorkOrders({}, canView);
  const companiesQuery = useCompanies();
  const workOrders = useMemo(() => workOrdersQuery.data ?? [], [workOrdersQuery.data]);
  const dealIds = useMemo(() => workOrders.map((w) => w.dealId).filter((id): id is string => !!id), [workOrders]);
  const dealsQuery = useDealsByIds(dealIds, seesJobs);
  const ready = usePageReady(
    !permsLoading && settled(workOrdersQuery) && settled(companiesQuery) && (!seesJobs || dealIds.length === 0 || settled(dealsQuery)),
  );
  const { widthOf, setWidth, reset } = useColumnWidths("work-orders-list", WIDTHS);

  const companies = useMemo(() => new Map((companiesQuery.data ?? []).map((c) => [c.id, c] as const)), [companiesQuery.data]);
  const jobNumbers = useMemo(
    () => new Map((dealsQuery.data ?? []).map((d) => [d.id, d.dealNumber ?? ""] as const)),
    [dealsQuery.data],
  );
  const companyName = (id: string) => companies.get(id)?.title ?? "";
  const jobNumber = (id: string) => (seesJobs ? jobNumbers.get(id) ?? "" : "");

  const stats = useMemo(() => workOrderStats(workOrders), [workOrders]);
  const groups = useMemo(() => workOrderFilterGroups(companiesQuery.data ?? [], workOrders), [companiesQuery.data, workOrders]);
  const filtered = useMemo(() => filterWorkOrders(workOrders, filter), [workOrders, filter]);

  // What Search looks in and what the headers sort by.
  const gridColumns = useMemo<WzGridColumn<WorkOrder>[]>(
    () => [
      { id: "woNumber", label: "WO NO.", render: () => null, sortValue: (w) => w.woNumber, searchText: (w) => w.woNumber },
      {
        id: "client",
        label: "Client",
        render: () => null,
        sortValue: (w) => companies.get(w.companyId)?.title,
        searchText: (w) => companies.get(w.companyId)?.title,
      },
      { id: "date", label: "Date", render: () => null, sortValue: (w) => w.date },
      { id: "amount", label: "Amount", render: () => null, sortValue: (w) => w.amount },
      { id: "status", label: "Status", render: () => null, sortValue: (w) => WORK_ORDER_STATUSES.indexOf(w.status) },
      {
        id: "job",
        label: "Job",
        render: () => null,
        sortValue: (w) => (w.dealId && seesJobs ? jobNumbers.get(w.dealId) : undefined),
        searchText: (w) => (w.dealId && seesJobs ? jobNumbers.get(w.dealId) : undefined),
      },
      { id: "description", label: "Description", render: () => null, sortValue: (w) => w.description, searchText: (w) => w.description },
    ],
    [companies, jobNumbers, seesJobs],
  );
  const view = useMemo(() => localGridView(filtered, gridColumns, { query, sort, page, size: pageSize }), [filtered, gridColumns, query, sort, page, pageSize]);

  const columns = useMemo<WzReportColumn<WorkOrder>[]>(() => {
    const cell: Record<ColumnId, (w: WorkOrder) => React.ReactNode> = {
      // Ink, as Workiz's document numbers are; the row opens the same place.
      woNumber: (w) => (
        <Link href={workOrderHref(w.id)} onClick={stop} className="block truncate text-foreground no-underline">
          {w.woNumber}
        </Link>
      ),
      client: (w) => <ClientCell company={companies.get(w.companyId)} />,
      date: (w) => <Text>{workizDate(w.date)}</Text>,
      amount: (w) => <Text>{w.amount != null ? money(w.amount) : ""}</Text>,
      status: (w) => <Text>{workOrderStatusLabel(w.status)}</Text>,
      job: (w) => {
        const number = w.dealId && seesJobs ? jobNumbers.get(w.dealId) : undefined;
        return number ? (
          <Link href={`/deals/${w.dealId}`} onClick={stop} className="block truncate text-foreground no-underline">
            {number}
          </Link>
        ) : null;
      },
      description: (w) => <Text>{w.description ?? ""}</Text>,
    };
    return COLUMNS.map((c) => ({ id: c.id, label: c.label, sortable: true, cell: cell[c.id] }));
  }, [companies, jobNumbers, seesJobs]);

  // The refusal only once the answer is in — before it, `can` says no to all.
  if (denied("work_orders", "view")) return <NoAccess what="work orders" />;

  const pickCard = (status: WorkOrderStatus) => {
    setActiveCard(status);
    setFilter((f) => ({ ...f, status: [status] }));
    setPage(1);
  };
  const open = (w: WorkOrder, e: WzRowOpenEvent) => {
    const href = workOrderHref(w.id);
    if (e.metaKey || e.ctrlKey || ("button" in e && e.button === 1)) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };
  const exportRows = () => {
    // Every row the filters and the search keep, in the grid's order — not just this page.
    const all = localGridView(filtered, gridColumns, { query, sort, page: 1, size: Math.max(1, filtered.length) }).rows;
    downloadCsv("work-orders.csv", workOrdersCsv(all, { companyName, jobNumber }));
  };
  const pager = {
    page: view.page,
    from: view.from,
    to: view.to,
    total: view.total,
    totalPages: view.pages,
    canPrev: view.page > 1,
    canNext: view.page < view.pages,
    isFetching: false,
    prev: () => setPage(view.page - 1),
    next: () => setPage(view.page + 1),
  };

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="work-orders-scroller">
      {/* The cards: 31px apart, 20px in, 34px under the breadcrumbs (the Invoices row of four). */}
      <div className="grid shrink-0 grid-cols-2 items-start gap-[31px] px-5 pt-[34px] xl:grid-cols-4" aria-label="Filter by status">
        {WORK_ORDER_STATUSES.map((s) => {
          if (!ready) return <WzKpiCardSkeleton key={s} />;
          const text = workOrderCardText(s, stats[s]);
          return (
            <WzKpiCard
              key={s}
              value={text.value}
              caption={text.caption}
              label={text.label}
              wrapCaption
              selected={activeCard === s}
              selectedTone="orange"
              onSelect={() => pickCard(s)}
            />
          );
        })}
      </div>

      {/* Filter results 28px under the cards, + Add New at the right (the Clients row). The left column
          keeps the height of the row Workiz keeps under its list filters for bulk actions (none here), so
          the strip sits where the Invoices strip does. */}
      <div className="flex shrink-0 items-start gap-5 px-5 pt-7 pb-5">
        <div className="min-h-[92px] max-w-[664px] min-w-0 flex-1">
          <WzGroupedFilter
            placeholder="Filter results"
            groups={groups}
            value={filter}
            onChange={(next) => {
              setFilter(next as WorkOrderFilterValue);
              setPage(1);
            }}
          />
        </div>
        {can("work_orders", "create") ? (
          <Button className="ml-auto h-8 shrink-0 gap-[3px] border-0 px-3" onClick={() => setAdding(true)}>
            <Plus className="size-5" strokeWidth={2} />
            <span className="px-1">Add New</span>
          </Button>
        ) : null}
      </div>

      {/* The grey strip: Search; the page size and Export at the right. */}
      <WzListToolbar className="shrink-0">
        <WzSearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          maxLength={100}
        />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect
            value={pageSize}
            sizes={REPORT_PAGE_SIZES}
            onChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
          <WzToolbarButton onClick={exportRows} disabled={!ready || view.total === 0}>
            <FileText strokeWidth={1.5} /> Export
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      {ready && workOrdersQuery.error ? (
        <div role="alert" className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p>{getApiErrorMessage(workOrdersQuery.error, "Couldn't load work orders")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void workOrdersQuery.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <WzReportGrid
          aria-label="Work orders"
          className="shrink-0"
          columns={columns}
          rows={ready ? view.rows : []}
          rowKey={(w) => w.id}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(id) => {
            setSort((s) => (s?.id === id ? { id, dir: s.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" }));
            setPage(1);
          }}
          resize={{ widthOf, setWidth, reset }}
          onRowClick={open}
          loading={!ready}
          plainFiller
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

      <CreateWorkOrderDialog open={adding} onOpenChange={setAdding} companies={companiesQuery.data ?? []} />
    </div>
  );
}

/**
 * Workiz's ClientTableCell for a company: the name (16px), then its email
 * (12px) or its phone as a blue call link. Blocks, cut at the cell's edge.
 */
function ClientCell({ company }: { company: Company | undefined }) {
  if (!company) return null;
  const email = company.emails?.[0];
  const phone = company.phones?.[0];
  return (
    <>
      <div className="truncate text-base leading-6 tracking-[0.2px] text-foreground">{company.title}</div>
      {email ? (
        <div className="truncate text-xs leading-[18px] text-foreground">{email}</div>
      ) : phone ? (
        <a href={`tel:${phone}`} onClick={stop} className={cn("table text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline")}>
          {formatPhone(phone)}
        </a>
      ) : null}
    </>
  );
}
