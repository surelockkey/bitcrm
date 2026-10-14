import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Deal } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getContact } from "@/features/clients/api";
import { getDealProducts } from "./api";

/** As long as `useContact` keeps a client fresh. */
const WARM_MS = 30_000;

/**
 * Warm the quick view while the cursor is still on the Job ID, so the drawer
 * opens whole: the list row already is the job (it becomes the job's own
 * cache entry unless a fresher one is in hand), and the client and the lines
 * are asked for now rather than after the slide-in.
 */
export function prefetchQuickView(queryClient: QueryClient, deal: Deal): void {
  const key = queryKeys.deals.detail(deal.id);
  if (queryClient.getQueryData(key) === undefined) queryClient.setQueryData(key, deal);
  if (deal.contactId) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.contacts.detail(deal.contactId),
      queryFn: () => getContact(deal.contactId),
      staleTime: WARM_MS,
    });
  }
  void queryClient.prefetchQuery({
    queryKey: queryKeys.deals.products(deal.id),
    queryFn: () => getDealProducts(deal.id),
    staleTime: WARM_MS,
  });
}

/** The list's `onPeek`: warms the quick view of the job the cursor is on. */
export function useQuickViewPeek(): (deal: Deal) => void {
  const queryClient = useQueryClient();
  return (deal) => prefetchQuickView(queryClient, deal);
}
