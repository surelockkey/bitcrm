"use client";

import { WorkOrderView } from "./work-order-view";
import { WorkOrdersList } from "./work-orders-list";

/**
 * `/work-orders`: the registry of Platinum clients' work orders, drawn as
 * Workiz's lists are; `?id=` (a job's Actions → View Work Order, a row of the
 * list) is one work order, drawn as Workiz's work order page.
 */
export function WorkOrdersPage({ initialId }: { initialId?: string } = {}) {
  return initialId ? <WorkOrderView key={initialId} id={initialId} /> : <WorkOrdersList />;
}
