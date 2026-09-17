import { ForbiddenException } from '@nestjs/common';
import { getDataScopeFilter } from '@bitcrm/shared';
import { DataScope, type Deal, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';

/** Who is calling: the Cognito user and the permissions the guard resolved. */
export interface Caller {
  user: JwtUser;
  perms?: ResolvedPermissions | null;
}

export type BillingResource = 'invoices' | 'estimates';

/**
 * `assigned_only` for billing documents means "documents of jobs I'm
 * assigned to" (technicians). `department` has no meaning for a job
 * document and is treated as `all`, like deal-service does for lists.
 * Without resolved permissions (a route with no @RequirePermission) there is
 * nothing to restrict by.
 */
export function isAssignedOnly(caller: Caller, resource: BillingResource): boolean {
  if (!caller.perms) return false;
  const filter = getDataScopeFilter(
    { id: caller.user.id, department: caller.user.department },
    resource,
    caller.perms,
  );
  return filter.scope === DataScope.ASSIGNED_ONLY;
}

export function assertDealAccess(
  caller: Caller,
  resource: BillingResource,
  deal: Pick<Deal, 'assignedTechIds'>,
): void {
  if (!isAssignedOnly(caller, resource)) return;
  if (!(deal.assignedTechIds ?? []).includes(caller.user.id)) {
    throw new ForbiddenException('You are not assigned to this job');
  }
}
