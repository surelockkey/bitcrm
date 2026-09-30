import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** The two roots a location's queries live under — see `queryKeys.inventory.locationStock`. */
const ROOTS: Record<string, "warehouses" | "containers"> = {
  warehouse: "warehouses",
  container: "containers",
};

/** One end of a movement, as a transfer or a request names it. `null` is a job, a supplier or a return. */
export interface MovementEnd {
  type?: string | null;
  id?: string | null;
}

/**
 * Refresh exactly what a stock movement changed.
 *
 * A movement touches two locations (their stock, their row's totals), the
 * items it carried (`onHand` and their per-location split), the journal, and
 * the template comparisons of the van and warehouse involved. Invalidating the
 * whole `containers` / `warehouses` roots instead refetched every loaded page
 * of every list, a stock read per van on screen, the fleet pickers and the
 * counts — a hundred requests for one Move, and a flickering table under the
 * popup. Only active queries refetch; the rest are just marked stale.
 */
export function refreshAfterMovement(
  qc: QueryClient,
  ends: MovementEnd[],
  productIds: Iterable<string>,
): Promise<void> {
  const locations = new Set<string>();
  const vans = new Set<string>();
  const shops = new Set<string>();
  for (const end of ends) {
    const root = end.type ? ROOTS[end.type] : undefined;
    if (!root || !end.id) continue;
    locations.add(`${root}:${end.id}`);
    (root === "containers" ? vans : shops).add(end.id);
  }
  const items = new Set(productIds);

  const touched = (key: QueryKey): boolean => {
    const [root, second, third] = key;
    switch (root) {
      case "products":
        // The Items list shows `onHand`; the moved items' popups show it and their split.
        return (
          second === "list" ||
          (second === "detail" && items.has(third as string)) ||
          (third === "stock" && items.has(second as string))
        );
      case "warehouses":
      case "containers":
        // Rows carry the location totals; the two ends' own stock and detail changed.
        if (second === "list") return true;
        if (second === "detail") return locations.has(`${root}:${third}`);
        if (third === "location-stock" || third === "stock") return locations.has(`${root}:${second}`);
        return false;
      case "transfers":
        return second === "list" || second === "count";
      case "container-templates":
        // [root, templateId, "diff", containerId, warehouseId]
        return key[2] === "diff" && (vans.has(key[3] as string) || shops.has(key[4] as string));
      default:
        return false;
    }
  };

  return qc.invalidateQueries({ predicate: (q) => touched(q.queryKey) });
}

/**
 * Refresh a location's rows after it was created, renamed, archived or
 * reassigned: the lists, the counts, the pickers and its own detail — never
 * the stock reads, which the change did not touch.
 */
export function refreshLocationRows(
  qc: QueryClient,
  root: "warehouses" | "containers",
  id?: string,
): Promise<void> {
  return qc.invalidateQueries({
    predicate: ({ queryKey: [r, second, third] }) =>
      r === root &&
      (second === "list" ||
        second === "count" ||
        second === "everything" ||
        second === "mine" ||
        (second === "detail" && (id === undefined || third === id))),
  });
}
