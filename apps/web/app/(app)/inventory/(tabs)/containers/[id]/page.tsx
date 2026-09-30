import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ContainersPage } from "@/features/inventory/containers/components/containers-page";

/**
 * A link to a van (the search index, a bookmark) lands on the Containers tab
 * with its stock open — or its Edit popup for the old `?tab=settings`. The
 * popup is the list's state; closing it leaves `/inventory/containers`.
 * `params` and `searchParams` are Promises in Next 16.
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
  return (
    <Suspense fallback={<TabFallback tab="containers" />}>
      <ContainersPage initialPopup={{ kind: tab === "settings" ? "edit" : "stock", id }} />
    </Suspense>
  );
}
