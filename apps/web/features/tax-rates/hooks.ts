"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TaxRate } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/**
 * Every area-derived tax rate (inactive included). Read by the job, estimate
 * and invoice screens to populate pickers, so it's cached generously. Service
 * area writes invalidate it.
 */
export function useTaxRates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.taxRates.list(),
    queryFn: api.listTaxRates,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Active rates only (the server's order is kept). */
export function useActiveTaxRates(enabled = true) {
  const q = useTaxRates(enabled);
  const active = useMemo<TaxRate[]>(() => (q.data ?? []).filter((r) => r.active), [q.data]);
  return { ...q, active };
}
