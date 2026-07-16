import { ContactDetailPage } from "@/features/clients/components/contact-detail-page";

/** Full-page contact detail. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactDetailPage contactId={id} />;
}
