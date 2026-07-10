import { CompanyDetailPage } from "@/features/clients/components/company-detail-page";

/** Full-page company detail. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyDetailPage companyId={id} />;
}
