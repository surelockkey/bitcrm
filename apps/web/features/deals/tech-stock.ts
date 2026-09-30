import { useQuery } from "@tanstack/react-query";
import { fetchAllContainers, getLocationStock, type LocationStockRow } from "@/features/inventory/stock/api";

/**
 * The van a technician works from. Resolved client-side by `technicianId`
 * over every page of containers, not the first.
 */
async function techContainerId(techId: string): Promise<string | undefined> {
  const containers = await fetchAllContainers();
  return containers.find((c) => c.technicianId === techId)?.id;
}

/**
 * What a technician carries, named and in name order — one location-stock
 * read, no catalog behind it. Empty for a technician without a van.
 */
export async function fetchTechStockRows(techId: string): Promise<LocationStockRow[]> {
  const containerId = await techContainerId(techId);
  if (!containerId) return [];
  return (await getLocationStock("container", containerId)).rows;
}

/** The same stock as `productId → quantity`, for sourcing a job line. */
export async function fetchTechStock(techId: string): Promise<Map<string, number>> {
  const rows = await fetchTechStockRows(techId);
  return new Map(rows.map((r) => [r.productId, r.quantity]));
}

/** The technician's carried items, named — for the assign dialog's list. */
export function useTechStock(techId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["deal-tech-stock-rows", techId],
    queryFn: () => fetchTechStockRows(techId!),
    enabled: enabled && !!techId,
    retry: false,
  });
}
