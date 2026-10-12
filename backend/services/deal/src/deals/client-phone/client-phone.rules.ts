import { JobSuperStatus, type ClientPhoneScope, type Deal } from '@bitcrm/types';
import { hasBalanceDue } from '../deal-balance';

/** One first number changed on a job — what the job page's "Apply these changes to…" sends. */
export interface ClientPhoneChange {
  /** The job it was changed on. */
  dealId: string;
  /** The new number (E.164). */
  phone: string;
  /** The client profile's first number before the change; undefined when it had none. */
  previous: string | undefined;
  scope: ClientPhoneScope;
}

export type ClientPhoneJob = Pick<
  Deal,
  'id' | 'clientPhone' | 'phones' | 'superStatus' | 'totals' | 'amountPaid' | 'paymentStatus'
>;

const OPEN = new Set<JobSuperStatus>([JobSuperStatus.SUBMITTED, JobSuperStatus.IN_PROGRESS, JobSuperStatus.PENDING]);

/**
 * "Open and unpaid jobs only. Paid and closed jobs never change." Open is
 * work still to do — done pending approval is done; paid is a job with money
 * on it and nothing left owing (`hasBalanceDue`, the jobs list's rule).
 */
export function changesWithClient(job: ClientPhoneJob): boolean {
  if (!OPEN.has(job.superStatus)) return false;
  const total = job.totals?.total;
  const paidInFull = typeof total === 'number' && total > 0 && !hasBalanceDue(job);
  return !paidInFull;
}

/**
 * A job that follows the profile carries no number of its own — unless it
 * came from Workiz with numbers of its own (`phones`), which the screens
 * that read them would otherwise keep showing; then the new number is
 * written so it wins over them.
 */
const following = (job: ClientPhoneJob, phone: string): string | null =>
  job.phones?.some(Boolean) ? phone : null;

/**
 * What one of the client's jobs' `clientPhone` becomes: a number, `null` to
 * drop it, or `undefined` to leave the row alone. The job's first number is
 * its own `clientPhone`, else the profile's; the other jobs move only when
 * they showed the old profile number, so a job given a number of its own
 * keeps it whatever the scope.
 */
export function nextClientPhone(job: ClientPhoneJob, change: ClientPhoneChange): string | null | undefined {
  const current = job.clientPhone ?? null;
  const keep = (next: string | null) => (next === current ? undefined : next);
  const { phone, previous, scope } = change;

  if (job.id === change.dealId) {
    if (scope === 'job') return keep(phone === previous ? following(job, phone) : phone);
    return keep(following(job, phone));
  }

  if (scope === 'job' || !previous) return undefined;
  if ((job.clientPhone ?? previous) !== previous) return undefined;
  if (scope === 'open_jobs' && changesWithClient(job)) return keep(following(job, phone));
  return keep(previous);
}
