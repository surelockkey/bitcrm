import { PortalPreviewPage } from "@/features/portal/components/portal-preview-page";

export default async function Page({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  return <PortalPreviewPage contactId={contactId} />;
}
