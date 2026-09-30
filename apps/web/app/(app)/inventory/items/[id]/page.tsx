import { redirect } from "next/navigation";

/**
 * Items open as a popup on the Items tab now; an old link to an item's page
 * lands on that popup. `params` is a Promise in Next 16.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/inventory/items?edit=${encodeURIComponent(id)}`);
}
