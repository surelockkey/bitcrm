import { TechJobPage } from "@/features/tech/components/tech-job-page";
import { parseDealTab } from "@/features/deals/deal-tabs";

/** The technician's view of one job — the job page, as `/deals/[id]`. `params`/`searchParams` are Promises in Next 16. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const estimate = Array.isArray(query.estimate) ? query.estimate[0] : query.estimate;
  return <TechJobPage key={id} dealId={id} initialTab={parseDealTab(query.tab)} initialEstimateId={estimate ?? null} />;
}
