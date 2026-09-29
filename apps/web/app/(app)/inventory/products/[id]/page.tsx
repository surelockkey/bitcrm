import { redirect } from "next/navigation";

/**
 * The search index links a product hit to `/inventory/products/<id>`, a page
 * the web never had. Hand it to the item's Edit popup on the Items tab.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/inventory/items?edit=${encodeURIComponent(id)}`);
}
