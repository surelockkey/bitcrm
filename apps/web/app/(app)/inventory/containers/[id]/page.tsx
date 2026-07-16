import { ContainerDetailPage } from "@/features/inventory/containers/components/container-detail-page";

/** Full-page container detail. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContainerDetailPage containerId={id} />;
}
