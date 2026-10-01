import { StandaloneEstimatePage } from "@/features/estimates/components/estimate-page";

/** A client's estimate (no job) on its own page. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StandaloneEstimatePage key={id} estimateId={id} />;
}
