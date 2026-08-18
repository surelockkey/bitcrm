import { randomUUID } from 'node:crypto';
import { JobSuperStatus, type DealSubStatus, type JobTagColor } from '@bitcrm/types';

/**
 * The sub-status catalog migrated from the previous CRM, verbatim: same names,
 * filed under the same super-statuses. Colors follow the group's tone so the
 * pickers read at a glance. Canceled sub-statuses double as the cancellation
 * reason when a job is canceled with one selected.
 */
export const WORKIZ_SUBSTATUSES: {
  name: string;
  group: JobSuperStatus;
  color: JobTagColor;
}[] = [
  // Canceled — each name is a cancellation reason.
  { name: 'Will Call Back', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'Cant Do - tech said cant do', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'Customer Resolved', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'Went with a different company', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'CANCELED - LEAD', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'No Tech', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'NOT RELEVANT - job not served', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'High Price', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'Out of area', group: JobSuperStatus.CANCELED, color: 'red' },
  { name: 'Because of the Office', group: JobSuperStatus.CANCELED, color: 'red' },
  // In progress
  { name: 'In progress', group: JobSuperStatus.IN_PROGRESS, color: 'blue' },
  { name: 'Job Done', group: JobSuperStatus.IN_PROGRESS, color: 'green' },
  { name: 'Job Accepted', group: JobSuperStatus.IN_PROGRESS, color: 'blue' },
  { name: 'Job Issues', group: JobSuperStatus.IN_PROGRESS, color: 'amber' },
  { name: 'Platinum', group: JobSuperStatus.IN_PROGRESS, color: 'violet' },
  // Pending
  { name: 'NO ANSWER', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'QUOTE - FOLLOW UP', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'WILL CALL BACK - FOLLOW-UP', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'CANCELED CHECK', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'Waiting for parts', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'WAITING FOR APPROVAL', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'WAITING FOR AN ESTIMATE', group: JobSuperStatus.PENDING, color: 'amber' },
  { name: 'Platinum updates', group: JobSuperStatus.PENDING, color: 'violet' },
  // Done pending approval
  { name: 'BILLING', group: JobSuperStatus.DONE_PENDING_APPROVAL, color: 'teal' },
  { name: 'CHEQUE', group: JobSuperStatus.DONE_PENDING_APPROVAL, color: 'teal' },
  { name: 'TECHNICAL ERROR', group: JobSuperStatus.DONE_PENDING_APPROVAL, color: 'teal' },
  { name: 'SUB BILLING', group: JobSuperStatus.DONE_PENDING_APPROVAL, color: 'teal' },
];

/**
 * Full definitions for the sub-statuses that still need creating, skipping
 * names the catalog already has (case-insensitive) so reruns are safe.
 * Priority descends with list order inside each group ("higher sorts first").
 */
export function planWorkizSubStatusSeed(existingNames: string[]): DealSubStatus[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const now = new Date().toISOString();

  const perGroupTotal = new Map<string, number>();
  for (const s of WORKIZ_SUBSTATUSES) {
    perGroupTotal.set(s.group, (perGroupTotal.get(s.group) ?? 0) + 1);
  }

  const out: DealSubStatus[] = [];
  const seen = new Map<string, number>();
  for (const s of WORKIZ_SUBSTATUSES) {
    const index = seen.get(s.group) ?? 0;
    seen.set(s.group, index + 1);
    if (taken.has(s.name.toLowerCase())) continue;
    out.push({
      id: randomUUID(),
      name: s.name,
      group: s.group,
      color: s.color,
      priority: (perGroupTotal.get(s.group) ?? 1) - index,
      active: true,
      createdBy: 'workiz-seed',
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}
