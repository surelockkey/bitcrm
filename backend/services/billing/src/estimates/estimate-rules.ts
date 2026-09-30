import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  calculateDocumentTotals,
  type DocumentTotals,
  type Estimate,
  type EstimateItem,
  type EstimateStatus,
} from '@bitcrm/types';

/** Pure estimate rules — numbering, status stamps, sync guard, ordering, totals. */

export function estimateNumber(dealNumber: string, seq: number): string {
  return `${dealNumber}-${seq}`;
}

const STAMP: Partial<Record<EstimateStatus, 'approvedAt' | 'declinedAt' | 'wonAt'>> = {
  approved: 'approvedAt',
  declined: 'declinedAt',
  won: 'wonAt',
};

/** Field changes for a (manual or system) status move. Empty when unchanged. */
export function statusChanges(
  estimate: Pick<Estimate, 'status'>,
  next: EstimateStatus,
  now: string,
): Partial<Estimate> {
  if (estimate.status === next) return {};
  const changes: Partial<Estimate> = { status: next, statusChangedAt: now };
  const stamp = STAMP[next];
  if (stamp) changes[stamp] = now;
  return changes;
}

/**
 * Mark sent / unsent. Sending an unsent estimate makes it `pending` (Workiz);
 * un-sending removes the stamps and puts a still-`pending` estimate back to
 * `unsent` — any other status was a deliberate decision and is kept.
 */
export function markSentChanges(
  estimate: Pick<Estimate, 'status'>,
  sent: boolean,
  userId: string,
  now: string,
): { set: Partial<Estimate>; remove: Array<'sentAt' | 'sentBy'> } {
  if (sent) {
    return {
      set: {
        sentAt: now,
        sentBy: userId,
        ...(estimate.status === 'unsent' ? statusChanges(estimate, 'pending', now) : {}),
      },
      remove: [],
    };
  }
  return {
    set: estimate.status === 'pending' ? statusChanges(estimate, 'unsent', now) : {},
    remove: ['sentAt', 'sentBy'],
  };
}

export function assertSyncable(estimate: Pick<Estimate, 'status'>, itemCount: number): void {
  if (estimate.status === 'archived') {
    throw new UnprocessableEntityException('An archived estimate cannot be synced to the job');
  }
  if (itemCount < 1) {
    throw new UnprocessableEntityException('The estimate needs at least one item to sync to the job');
  }
}

/**
 * New positions for `lineIds` (which must be exactly the estimate's lines),
 * only for the lines whose position actually changes.
 */
export function reorderPositions(
  items: Pick<EstimateItem, 'lineId' | 'position'>[],
  lineIds: string[],
): Array<{ lineId: string; position: number }> {
  const current = new Map(items.map((i) => [i.lineId, i.position]));
  const unique = new Set(lineIds);
  if (unique.size !== lineIds.length || lineIds.length !== items.length || lineIds.some((id) => !current.has(id))) {
    throw new BadRequestException('lineIds must list every line of the estimate exactly once');
  }
  return lineIds
    .map((lineId, position) => ({ lineId, position }))
    .filter(({ lineId, position }) => current.get(lineId) !== position);
}

export function sortItems<T extends Pick<EstimateItem, 'position' | 'createdAt'>>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function estimateTotals(
  estimate: Pick<Estimate, 'taxRatePercent' | 'taxSource' | 'discount'>,
  items: Pick<EstimateItem, 'quantity' | 'priceClient' | 'taxable'>[],
): DocumentTotals {
  return calculateDocumentTotals({
    lines: items.map((i) => ({ quantity: i.quantity, priceClient: i.priceClient, taxable: i.taxable })),
    taxRatePercent: estimate.taxSource === 'exempt' ? 0 : estimate.taxRatePercent ?? 0,
    discount: estimate.discount ?? undefined,
  });
}
