import type { DealStats } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** `GET /deals/stats` over the jobs created in `from..to` (inclusive days). */
export const getDealStats = (window: { from: string; to: string }): Promise<DealStats> =>
  http.get<DealStats>(`/deals/stats?${new URLSearchParams({ createdFrom: window.from, createdTo: window.to })}`);
