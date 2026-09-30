import { redirect } from "next/navigation";

/**
 * The search index links a product hit to `/inventory/products/<id>`, a page
 * the web never had. It is the item's own address now: `/inventory/items/<id>`,
 * the Items tab with the item's Edit popup open. `params` is a Promise in Next 16.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/inventory/items/${encodeURIComponent(id)}`);
}
