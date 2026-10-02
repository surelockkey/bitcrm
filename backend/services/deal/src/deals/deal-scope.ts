import { ForbiddenException } from '@nestjs/common';
import { DataScope, type Deal, type JwtUser } from '@bitcrm/types';

/**
 * The `deals` data scope on a write to ONE job: a caller whose scope is
 * `assigned_only` — a technician — may change only a job whose roster he is
 * on (403 otherwise). A wider scope (`department`, `all`) is the office and
 * passes; so does an absent one, as on the technician-flow routes.
 *
 * The job's items, its tax and its discount are written through routes that
 * load the job by id, so without this a technician could change them on any
 * job whose id he had.
 */
export function assertDealInScope(
  deal: Pick<Deal, 'assignedTechIds'>,
  caller: Pick<JwtUser, 'id'>,
  dealScope?: string,
): void {
  if (dealScope !== DataScope.ASSIGNED_ONLY) return;
  if ((deal.assignedTechIds ?? []).includes(caller.id)) return;
  throw new ForbiddenException('Only a technician assigned to this job can do that');
}
