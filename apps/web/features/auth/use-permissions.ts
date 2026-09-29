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

/**
 * Whether to refuse a screen — and **false while the answer is still coming**.
 *
 * `can()` says no to everything until the permission matrix has loaded,
 * because there is nothing yet to say yes with. A screen written as
 * `if (!can(...)) return <NoAccess/>` therefore refuses itself on every
 * refresh and corrects a moment later, which the reader sees as a flash of
 * "No access". Refusing is an assertion: make it only once it is known true.
 *
 * A hook of its own rather than another field on `usePermissions`, so the many
 * suites that stub that hook keep working: a stub with no `isLoading` reads as
 * "still loading" and therefore never refuses, which is what a test that only
 * wants the page rendered already means.
 */
export function useDenied() {
  const { can, isLoading } = usePermissions();
  return (resource: Resource, action: Action = "view") => !isLoading && !can(resource, action);
}
