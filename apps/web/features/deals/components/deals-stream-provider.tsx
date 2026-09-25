"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useDealsStream } from "../use-deals-stream";

/**
 * Keeps the jobs stream open for anyone who may see jobs (the server checks
 * the same `deals.view`). Renders nothing; lives in the app shell.
 */
export function DealsStreamProvider() {
  const { can, isLoading } = usePermissions();
  useDealsStream(!isLoading && can("deals"));
  return null;
}
