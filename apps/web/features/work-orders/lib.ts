import { WorkOrderStatus, type WorkOrder } from "@bitcrm/types";

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  [WorkOrderStatus.OPEN]: "Open",
  [WorkOrderStatus.IN_PROGRESS]: "In progress",
  [WorkOrderStatus.CLOSED]: "Closed",
  [WorkOrderStatus.ARCHIVED]: "Archived",
};

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export interface WorkOrderFilter {
  /** One work order — the job page's "View Work Order". */
  id?: string;
  companyId?: string;
  status?: WorkOrderStatus;
  query?: string;
}

/** The registry narrowed to one work order. */
export const workOrderHref = (id: string): string => `/work-orders?id=${encodeURIComponent(id)}`;

export function filterWorkOrders(list: WorkOrder[], filter: WorkOrderFilter): WorkOrder[] {
  const q = filter.query?.trim().toLowerCase();
  return list.filter((w) => {
    if (filter.id && w.id !== filter.id) return false;
    if (filter.companyId && w.companyId !== filter.companyId) return false;
    if (filter.status && w.status !== filter.status) return false;
    if (q && !w.woNumber.toLowerCase().includes(q)) return false;
    return true;
  });
}
