import { StandaloneInvoicePage } from "@/features/invoices/components/invoice-page";

/** A client's invoice (no job) on its own page. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StandaloneInvoicePage key={id} invoiceId={id} />;
}
