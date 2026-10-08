import { WorkOrdersPage } from "@/features/work-orders/components/work-orders-page";

/** `?id=` opens the registry on one work order (a job's Actions → View Work Order). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await searchParams;
  return <WorkOrdersPage initialId={Array.isArray(id) ? id[0] : id} />;
}
