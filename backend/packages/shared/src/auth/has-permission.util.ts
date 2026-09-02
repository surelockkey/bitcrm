import { type ResolvedPermissions } from '@bitcrm/types';

/**
 * Evaluate one resource.action against an already-resolved permission set.
 *
 * This exists because some checks cannot be a `@RequirePermission` decorator:
 * a handler that everyone may call but where *part of the payload* is
 * privileged — a client's phone number on an otherwise readable contact — has
 * to ask the question itself, halfway through building the response.
 *
 * Two rules it centralises, both of which are easy to get wrong by hand:
 *
 *  - **Super Admin bypasses the matrix.** `PermissionGuard.evaluatePermission`
 *    returns early for them, so a hand-rolled `permissions[r]?.[a] === true`
 *    would redact data for the one role that is supposed to see everything.
 *  - **Absent means denied.** A role created before the action existed has no
 *    key for it. Reading that as "not restricted" inverts the guarantee, so
 *    only an explicit `true` grants.
 *
 * Unresolvable permissions (an ungated handler, a cache miss with the internal
 * API down) return false: an unknown viewer is not a trusted one.
 */
export function hasPermission(
  resolved: ResolvedPermissions | undefined | null,
  resource: string,
  action: string,
): boolean {
  if (!resolved) return false;

  if (resolved.isSystemRole && resolved.roleName === 'Super Admin') {
    return true;
  }

  return resolved.permissions?.[resource]?.[action] === true;
}
