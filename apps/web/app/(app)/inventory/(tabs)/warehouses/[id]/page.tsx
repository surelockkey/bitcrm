import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { WarehousesPage } from "@/features/inventory/warehouses/components/warehouses-page";

/**
 * A link to a warehouse (the search index, a bookmark) lands on the
 * Warehouses tab with its stock open — or its Edit popup for the old
 * `?tab=settings`. The popup is the list's state; closing it leaves
 * `/inventory/warehouses`. `params` and `searchParams` are Promises in Next 16.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return (
    <Suspense fallback={<TabFallback tab="warehouses" />}>
      <WarehousesPage initialPopup={{ kind: tab === "settings" ? "edit" : "stock", id }} />
    </Suspense>
  );
}
