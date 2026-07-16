import { WarehouseDetailPage } from "@/features/inventory/warehouses/components/warehouse-detail-page";

/** Full-page warehouse detail. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WarehouseDetailPage warehouseId={id} />;
}
