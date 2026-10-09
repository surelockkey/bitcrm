import { WorkOrderStatus, type WorkOrder } from "@bitcrm/types";
import type { WzFilterGroup, WzFilterValue } from "@/components/workiz/grouped-filter";
import { formatMoney } from "@/features/deals/lib";
import { workizDate } from "@/features/reports/billing/lib";

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  [WorkOrderStatus.OPEN]: "Open",
  [WorkOrderStatus.IN_PROGRESS]: "In progress",
  [WorkOrderStatus.CLOSED]: "Closed",
  [WorkOrderStatus.ARCHIVED]: "Archived",
};

/** The statuses in their working order: the cards left to right, the filter's Status column. */
export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.OPEN,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.CLOSED,
  WorkOrderStatus.ARCHIVED,
];

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** One work order's own view — the job page's Actions → "View Work Order", a row of the list. */
export const workOrderHref = (id: string): string => `/work-orders?id=${encodeURIComponent(id)}`;

/* ------------------------------------------------------------ Filter results */

export type WorkOrderFilterKey = "status" | "company";
export type WorkOrderFilterValue = WzFilterValue<WorkOrderFilterKey>;

/**
 * "Filter results" (Workiz's list filter, as on Invoices): Status, then the
 * clients that have work orders — every company would be hundreds of rows
 * for a handful of Platinum clients — by name.
 */
export function workOrderFilterGroups(
  companies: readonly { id: string; title: string }[],
  workOrders: readonly Pick<WorkOrder, "companyId">[],
): WzFilterGroup<WorkOrderFilterKey>[] {
  const names = new Map(companies.map((c) => [c.id, c.title] as const));
  const used = [...new Set(workOrders.map((w) => w.companyId).filter(Boolean))];
  const clients = used
    .map((id) => ({ value: id, label: names.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return [
    { key: "status", label: "Status", chip: "status", options: WORK_ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) },
    { key: "company", label: "Client", chip: "client", options: clients },
  ];
}

/** The picks: any value inside a group, every group with a pick. */
export function filterWorkOrders(list: readonly WorkOrder[], filter: WorkOrderFilterValue): WorkOrder[] {
  const statuses = filter.status?.length ? new Set(filter.status) : null;
  const companies = filter.company?.length ? new Set(filter.company) : null;
  return list.filter((w) => (!statuses || statuses.has(w.status)) && (!companies || companies.has(w.companyId)));
}

/* -------------------------------------------------------------------- cards */

export interface WorkOrderStat {
  count: number;
  amount: number;
}

/** How many work orders each status holds and what they are worth. */
export function workOrderStats(list: readonly WorkOrder[]): Record<WorkOrderStatus, WorkOrderStat> {
  const out = Object.fromEntries(WORK_ORDER_STATUSES.map((s) => [s, { count: 0, amount: 0 }])) as Record<WorkOrderStatus, WorkOrderStat>;
  for (const w of list) {
    const stat = out[w.status];
    if (!stat) continue;
    stat.count += 1;
    stat.amount += w.amount ?? 0;
  }
  return out;
}

/** The Estimates cards' words: the status big, "3 Worth $1,250.50" under it. */
export function workOrderCardText(
  status: WorkOrderStatus,
  stat: WorkOrderStat | undefined,
): { value: string; caption: string; label: string } {
  const value = STATUS_LABELS[status];
  const caption = `${stat?.count ?? 0} Worth ${formatMoney(stat?.amount ?? 0)}`;
  return { value, caption, label: `${caption} ${value}` };
}

/* ------------------------------------------------------------------- export */

const csvCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Export: the grid's columns for every row the filters keep, plain figures. */
export function workOrdersCsv(
  rows: readonly WorkOrder[],
  { companyName, jobNumber }: { companyName: (id: string) => string; jobNumber: (dealId: string) => string },
): string {
  const head = ["WO NO.", "Client", "Date", "Amount", "Status", "Job", "Description"];
  const lines = rows.map((w) =>
    [
      w.woNumber,
      companyName(w.companyId),
      w.date,
      w.amount != null ? w.amount.toFixed(2) : "",
      STATUS_LABELS[w.status] ?? w.status,
      w.dealId ? jobNumber(w.dealId) : "",
      w.description ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}

/* -------------------------------------------------------------------- paper */

/**
 * The table at the paper's top right — Workiz's work order prints
 * "Order NO. / Date / PO#" there (pg_workorders_wz_07_5TU7ZA_paper); ours has
 * no PO but a status and, once one is linked, the job it authorized.
 */
export function workOrderPaperRows(w: WorkOrder, { jobNumber }: { jobNumber?: string }): [string, string][] {
  const rows: [string, string][] = [
    ["Order NO.", w.woNumber],
    ["Date", workizDate(w.date)],
    ["Status", STATUS_LABELS[w.status] ?? w.status],
  ];
  if (jobNumber) rows.push(["Job", jobNumber]);
  return rows;
}
