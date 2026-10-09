"use client";

import { useEffect, useMemo } from "react";
import { UserStatus, type User } from "@bitcrm/types";
import { useAutomations } from "@/features/automations/hooks";
import { personName } from "@/features/deals/person-name";
import { useUsers } from "@/features/users/hooks";
import { settled } from "@/lib/use-page-ready";
import { NOTIFICATION_CATEGORY, isNotificationRule, type NotificationRule } from "./lib";

export { useAutomationsAccess as useNotificationsAccess } from "@/features/automations/hooks";

/**
 * The rows of the Notifications page: the automation rules filed under the
 * notification category. The server is asked for that category; the answer
 * is sieved here as well, so a dev API from before `backend/notifications`
 * (which answers the whole list) shows the same rows.
 */
export function useNotificationRules(enabled = true) {
  const query = useAutomations(enabled, { category: NOTIFICATION_CATEGORY });
  const rules = useMemo(() => ((query.data ?? []) as NotificationRule[]).filter(isNotificationRule), [query.data]);
  return { query, rules };
}

/** One person as the page prints them: the Notify cell, the "Who to notify" list, the pickers. */
export interface UserOption {
  id: string;
  name: string;
  email: string;
  user: User;
}

const ACTIVE = { status: UserStatus.ACTIVE };

/**
 * Every active user, all pages drained — the Notify cell names them and the
 * editor lists them, and a list that stopped at the first page would name
 * nobody past it. `allIn` is the page gate's word: the first page answered
 * and no page is left.
 */
export function useActiveUsers() {
  const query = useUsers(ACTIVE, 100);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const users = useMemo<UserOption[]>(
    () =>
      (query.data?.pages.flatMap((p) => p.data) ?? []).map((u) => ({
        id: u.id,
        name: personName(u) ?? u.email,
        email: u.email,
        user: u,
      })),
    [query.data],
  );
  const allIn = settled(query) && !hasNextPage;
  return { query, users, allIn };
}
