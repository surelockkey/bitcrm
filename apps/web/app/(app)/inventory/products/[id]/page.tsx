import { ProductEditorPage } from "@/features/inventory/products/components/product-editor-page";

/** Full-page product editor. `params` is a Promise in Next 16. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductEditorPage productId={id} />;
}
