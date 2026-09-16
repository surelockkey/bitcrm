import { TechJobPage } from "@/features/tech/components/tech-job-page";

/** The technician's view of one job. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TechJobPage dealId={id} />;
}
