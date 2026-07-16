"use client";

import { useQuery } from "@tanstack/react-query";
import type { User } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";

/** Current authenticated user (`GET /users/me`). */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => http.get<User>("/users/me"),
    staleTime: 5 * 60 * 1000,
  });
}
