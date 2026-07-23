import { useQuery } from "@tanstack/react-query";
import { listContainers, getContainerStock } from "@/features/inventory/containers/api";

/**
 * A technician's carried container stock as `productId → quantity`. Resolves the
 * tech's container by `technicianId` client-side (there's no tech-keyed
 * inventory endpoint) then reads its stock levels.
 */
export async function fetchTechStock(techId: string): Promise<Map<string, number>> {
  const containers = await listContainers();
  const container = containers.data.find((c) => c.technicianId === techId);
  if (!container) return new Map();
  const stock = await getContainerStock(container.id);
  return new Map(stock.map((s) => [s.productId, s.quantity]));
}

export function useTechStock(techId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["deal-tech-stock", techId],
    queryFn: () => fetchTechStock(techId!),
    enabled: enabled && !!techId,
    retry: false,
  });
}
