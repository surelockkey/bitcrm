"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ItemsReportJobRow, ItemsReportRow, ItemsReportSort, ItemsReportTotals } from "@bitcrm/types";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { personName } from "@/features/deals/person-name";
import { useUserMap } from "@/features/deals/hooks";
import { workizDate } from "../../jobs/lib";
import { useItemsReportJobs } from "../hooks";
import {
  itemJobsParams,
  itemSubline,
  itemsPager,
  marginText,
  money as moneyText,
  servicePlanText,
  totalUnitsText,
  unitsText,
  type ItemsReportState,
} from "../lib";

/*
 * The Items and services grid as Workiz draws it (rep_items_wz_01_loaded,
 * _12c_drill): react-table with the Item column fixed at 300px and the other
 * seven sharing the rest; the bold Total row first; each item's ▸ opening a
 * nested grid of its jobs under it.
 */

/** A line under a figure or a name: Workiz's `_tblLbl` (12px/16px #999, 5px down). */
function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-[5px] block text-xs leading-4 text-wz-caption">{children}</span>;
}

/** Workiz's links in the drill-down (`a.pointer`, `a.hoverLink`): the page's default #607890 (rep_items_wz_12c_drill). */
const LINK = "text-[#607890] hover:underline";

/**
 * react-table's `.rt-expander`: a 7px rgba(0,0,0,.8) triangle in a 10px box
 * with 10px either side, pointing right; open, it turns down (.3s, the
 * overshooting curve). Centred on the name's 16px line.
 */
const EXPANDER =
  "relative mx-2.5 mt-2 block h-0 w-2.5 shrink-0 after:absolute after:top-0 after:left-[5px] after:size-0 after:border-x-[5px] after:border-t-[7px] after:border-x-transparent after:border-t-black/80 after:content-[''] after:[transform:translate(-50%,-50%)_rotate(-90deg)] after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] data-open:after:[transform:translate(-50%,-50%)_rotate(0deg)]";

type GridRow = { kind: "total"; totals: ItemsReportTotals } | { kind: "item"; row: ItemsReportRow };

const one = (text: ReactNode) => <span className="block truncate">{text}</span>;

/** A money cell: bold on the Total row, plain on an item's. */
function figure(g: GridRow, pick: (r: ItemsReportRow | ItemsReportTotals) => number | undefined): ReactNode {
  return g.kind === "total" ? <b className="block truncate font-bold">{moneyText(pick(g.totals))}</b> : one(moneyText(pick(g.row)));
}

/**
 * The report grid: Workiz's eight columns (the money three only with
 * `financials.view`), the Total row first, the pager inside the frame. Every
 * header sorts on the server; the report opens on the items' numbers, newest
 * first, which no header shows (`sort="number"`).
 */
export function ItemsReportTable({
  rows,
  totals,
  money,
  sort,
  dir,
  onSort,
  state,
  loading,
  busy,
  footer,
}: {
  rows: ItemsReportRow[];
  totals: ItemsReportTotals | undefined;
  money: boolean;
  sort: ItemsReportSort;
  dir: "asc" | "desc";
  onSort: (column: ItemsReportSort) => void;
  /** The report's window and filters — an opened item's jobs are asked over the same. */
  state: ItemsReportState;
  loading?: boolean;
  busy?: boolean;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  const columns = useMemo<WzReportColumn<GridRow>[]>(() => {
    const all: (WzReportColumn<GridRow> & { money?: boolean })[] = [
      {
        id: "item",
        label: "Item",
        width: 300,
        sortable: true,
        headerClassName: "text-center font-normal",
        cell: (g) =>
          g.kind === "total" ? (
            <b className="font-bold">Total</b>
          ) : (
            <ItemCell row={g.row} open={open.has(g.row.key)} onToggle={() => toggle(g.row.key)} />
          ),
      },
      { id: "model", label: "Model #", sortable: true, cell: (g) => (g.kind === "item" ? one(g.row.model ?? "") : null) },
      {
        id: "units",
        label: "Units",
        sortable: true,
        cell: (g) => (g.kind === "total" ? <b className="block truncate font-bold">{totalUnitsText(g.totals)}</b> : one(unitsText(g.row.units))),
      },
      { id: "category", label: "Category", sortable: true, cell: (g) => (g.kind === "item" ? one(g.row.category ?? "") : null) },
      { id: "price", label: "Price", sortable: true, money: true, cell: (g) => figure(g, (r) => r.price) },
      { id: "cost", label: "Cost", sortable: true, money: true, cell: (g) => figure(g, (r) => r.cost) },
      {
        id: "profit",
        label: "Profit",
        sortable: true,
        money: true,
        cell: (g) =>
          g.kind === "total" ? (
            <div>
              <b className="block truncate font-bold">{moneyText(g.totals.profit)}</b>
              <Sub>{marginText(g.totals.margin)}</Sub>
            </div>
          ) : (
            <div>
              {one(moneyText(g.row.profit))}
              <Sub>{marginText(g.row.margin, g.row.profit)}</Sub>
            </div>
          ),
      },
      { id: "jobs", label: "Jobs", sortable: true, cell: (g) => (g.kind === "item" ? one(g.row.jobs) : null) },
    ];
    return all.filter((c) => money || !c.money);
  }, [money, open, toggle]);

  const gridRows = useMemo<GridRow[]>(
    () => (totals ? [{ kind: "total", totals }, ...rows.map((row) => ({ kind: "item" as const, row }))] : []),
    [rows, totals],
  );

  return (
    <WzReportGrid<GridRow>
      aria-label="Items and services"
      // Workiz's rows: 77px, the line over the grey `_tblLbl` line (rep_items).
      rowHeight={77}
      columns={columns}
      rows={gridRows}
      rowKey={(g) => (g.kind === "total" ? "__total" : g.row.key)}
      sort={sort === "number" ? null : { column: sort, dir }}
      onSort={(c) => onSort(c as ItemsReportSort)}
      loading={loading}
      busy={busy}
      footer={footer}
      padRowRule={false}
      renderExpanded={(g) => (g.kind === "item" && open.has(g.row.key) ? <ItemJobs item={g.row} state={state} money={money} /> : null)}
    />
  );
}

/** The Item cell: the whole cell opens the item's jobs, as react-table's expandable cell does. */
function ItemCell({ row, open, onToggle }: { row: ItemsReportRow; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} the jobs of ${row.name}`}
      onClick={onToggle}
      className="flex w-full min-w-0 cursor-pointer items-start text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span aria-hidden data-open={open || undefined} className={EXPANDER} />
      <span className="min-w-0">
        <span className="block">{row.name || "—"}</span>
        <Sub>{itemSubline(row)}</Sub>
      </span>
    </button>
  );
}

/** Rows of an opened item per page — Workiz asks 50. */
const JOBS_PAGE_SIZE = 50;

/**
 * Workiz's opened item (rep_items_wz_12c_drill): a box with a faint rule
 * above and 10px all round, holding a nested grid of the jobs that used the
 * item — nine equal columns, five rows at least, its own pager; while it
 * loads, the header over blank rows and the dots.
 */
function ItemJobs({ item, state, money }: { item: ItemsReportRow; state: ItemsReportState; money: boolean }) {
  const [page, setPage] = useState(1);
  const query = useItemsReportJobs(itemJobsParams(state, item.key, page, JOBS_PAGE_SIZE), true);
  const data = query.data;
  // Sellers named as Workiz names them ("(1) (Betty) Platinum Manager") when the directory knows them.
  const sellerIds = useMemo(() => (data?.rows ?? []).flatMap((r) => r.soldBy.map((s) => s.id)), [data]);
  const { map } = useUserMap(sellerIds);

  const columns = useMemo<WzReportColumn<ItemsReportJobRow>[]>(() => {
    const all: (WzReportColumn<ItemsReportJobRow> & { money?: boolean })[] = [
      {
        id: "job",
        label: "Job",
        cell: (r) => (
          <Link href={`/deals/${r.dealId}`} target="_blank" rel="noopener noreferrer" className={LINK}>
            Job #{r.jobNumber}
          </Link>
        ),
      },
      {
        id: "client",
        label: "Client",
        cell: (r) => (
          <div className="min-w-0">
            <Link href={`/contacts/${r.contactId}`} target="_blank" rel="noopener noreferrer" className={LINK}>
              {r.client || "—"}
            </Link>
            {r.clientCompany && r.clientCompany !== r.client ? <Sub>{r.clientCompany}</Sub> : null}
          </div>
        ),
      },
      { id: "date", label: "Date", cell: (r) => one(workizDate(r.jobDate)) },
      { id: "units", label: "Units", cell: (r) => one(unitsText(r.units)) },
      { id: "price", label: "Price", money: true, cell: (r) => one(moneyText(r.price)) },
      { id: "cost", label: "Cost", money: true, cell: (r) => one(moneyText(r.cost)) },
      {
        id: "profit",
        label: "Profit",
        money: true,
        cell: (r) => (
          <div>
            {one(moneyText(r.profit))}
            <Sub>{marginText(r.margin, r.profit)}</Sub>
          </div>
        ),
      },
      { id: "servicePlan", label: "Service Plan", cell: (r) => one(servicePlanText(r.servicePlan)) },
      {
        id: "soldBy",
        label: "Sold By",
        cell: (r) => one(r.soldBy.map((s) => personName(map.get(s.id)) || s.name).filter(Boolean).join(", ")),
      },
    ];
    return all.filter((c) => money || !c.money);
  }, [money, map]);

  return (
    <div className="border-t border-black/5 p-2.5" aria-label={`Jobs of ${item.name}`} role="region">
      {query.error ? (
        <p role="alert" className="p-5 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Could not load the jobs."}
        </p>
      ) : (
        <WzReportGrid<ItemsReportJobRow>
          aria-label="Jobs"
          // The drill-down's rows are 77px too (rep_items).
          rowHeight={77}
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(r) => r.dealId}
          minRows={5}
          stickyHeader={false}
          padRowRule={false}
          loading={!data}
          busy={query.isPlaceholderData && query.isFetching}
          footer={
            <WzPager
              plainNumbers
              loading={!data}
              pager={itemsPager(data?.pagination ?? { page, pageSize: JOBS_PAGE_SIZE, total: 0, pages: 1, from: 0, to: 0 }, setPage, query.isFetching)}
            />
          }
        />
      )}
    </div>
  );
}
