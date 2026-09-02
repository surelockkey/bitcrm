import { Suspense } from "react";
import { WarehouseDetailPage } from "@/features/inventory/warehouses/components/warehouse-detail-page";

/** Full-page warehouse detail. `params` is a Promise in Next 16. */
// useSearchParams (the `?tab=` deep link) must sit under a Suspense boundary.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <WarehouseDetailPage warehouseId={id} />
    </Suspense>
  );
}
