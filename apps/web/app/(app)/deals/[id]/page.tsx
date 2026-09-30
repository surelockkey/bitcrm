import { DealDetailPage } from "@/features/deals/components/deal-detail-page";
import { parseDealTab } from "@/features/deals/deal-tabs";

/** Full-page deal detail. `params`/`searchParams` are Promises in Next 16. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const estimate = Array.isArray(query.estimate) ? query.estimate[0] : query.estimate;
  return <DealDetailPage key={id} dealId={id} initialTab={parseDealTab(query.tab)} initialEstimateId={estimate ?? null} />;
}
