import { redirect } from "next/navigation";

/**
 * A van opens as a popup on the Containers tab now; an old link to its page
 * (the search index, a bookmark) lands on its stock — or on its Edit popup
 * for the old settings tab. `params` and `searchParams` are Promises in Next 16.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const popup = tab === "settings" ? "edit" : "stock";
  redirect(`/inventory/containers?${popup}=${encodeURIComponent(id)}`);
}
