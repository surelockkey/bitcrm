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
  companyId?: string;
  status?: WorkOrderStatus;
  query?: string;
}

export function filterWorkOrders(list: WorkOrder[], filter: WorkOrderFilter): WorkOrder[] {
  const q = filter.query?.trim().toLowerCase();
  return list.filter((w) => {
    if (filter.companyId && w.companyId !== filter.companyId) return false;
    if (filter.status && w.status !== filter.status) return false;
    if (q && !w.woNumber.toLowerCase().includes(q)) return false;
    return true;
  });
}
