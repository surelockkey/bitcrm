"use client";

import { useMemo } from "react";
import type { Resource, Action } from "@bitcrm/types";
import {
  resolvePermissions,
  can as canFn,
  scopeOf as scopeOfFn,
} from "@/lib/permissions/resolve";
import { useMe } from "./use-me";

/**
 * Effective permissions for the current user, resolved from their role +
 * per-user overrides. Drives nav visibility and action gating.
 */
export function usePermissions() {
  const { data: me, isLoading } = useMe();
  const resolved = useMemo(() => resolvePermissions(me), [me]);

  return {
    me,
    isLoading,
    resolved,
    roleName: resolved?.roleName ?? "",
    isTechnician: resolved?.isTechnician ?? false,
    can: (resource: Resource, action: Action = "view") =>
      canFn(resolved, resource, action),
    scopeOf: (resource: Resource) => scopeOfFn(resolved, resource),
  };
}
