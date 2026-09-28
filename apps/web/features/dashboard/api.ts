import type { JobsByStatusSeries } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * Скільки робіт створено кожного дня вікна і в якому вони стані зараз.
 * Сервер тримає відповідь тридцять секунд і сам обмежує вікно 92 днями.
 */
export function getJobsByStatus(window: {
  from: string;
  to: string;
}): Promise<JobsByStatusSeries> {
  const q = new URLSearchParams(window);
  return http.get<JobsByStatusSeries>(`/deals/stats/jobs-by-status?${q}`);
}
