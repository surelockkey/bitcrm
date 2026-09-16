"use client";

import { useEffect, useMemo } from "react";
import { UserStatus } from "@bitcrm/types";
import { useRoles } from "@/features/roles/hooks";
import { useUsers } from "@/features/users/hooks";
import { AutomationValuePicker, type PickerOption } from "./automation-value-picker";

/**
 * Who a `to: 'users'` action notifies. The spec has carried `userIds` since
 * the engine first resolved them (`action-executor.ts` recipients), but the
 * editor had no way to name anybody — so a rule saved as "selected users"
 * resolved to nobody and sent nothing, for ever, without a word. Mounted
 * only while that recipient is chosen, so opening the editor on an ordinary
 * rule still reads no user list at all.
 */
export function AutomationUserPicker({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useUsers({
    status: UserStatus.ACTIVE,
  });

  // A picker that stops at the first page would silently hide colleagues; a
  // workspace's user list is small and already cached by the users page.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const options = useMemo<PickerOption[]>(
    () =>
      (data?.pages.flatMap((p) => p.data) ?? []).map((u) => ({
        id: u.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
      })),
    [data],
  );

  return (
    <AutomationValuePicker
      label={label}
      options={options}
      values={values}
      onChange={(ids) => onChange(ids)}
      placeholder="Pick who to notify"
      emptyText={isLoading ? "Loading…" : "No active users"}
    />
  );
}

/** Who a `to: 'role'` action notifies — every active user holding one of these roles. */
export function AutomationRolePicker({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useRoles();
  const options = useMemo<PickerOption[]>(
    () => (data ?? []).map((r) => ({ id: r.id, name: r.name })),
    [data],
  );

  return (
    <AutomationValuePicker
      label={label}
      options={options}
      values={values}
      onChange={(ids) => onChange(ids)}
      placeholder="Pick a role"
      emptyText={isLoading ? "Loading…" : "No roles"}
    />
  );
}
