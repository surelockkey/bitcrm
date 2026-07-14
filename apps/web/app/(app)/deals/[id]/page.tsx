import { DealDetailPage } from "@/features/deals/components/deal-detail-page";

/** Full-page deal detail. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealDetailPage dealId={id} />;
}
