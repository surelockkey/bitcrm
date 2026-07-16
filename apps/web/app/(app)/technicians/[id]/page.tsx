import { TechnicianDetailPage } from "@/features/technicians/components/technician-detail-page";

/** Full-page technician detail. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TechnicianDetailPage technicianId={id} />;
}
