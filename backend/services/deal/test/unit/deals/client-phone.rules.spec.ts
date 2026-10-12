/**
 * "Apply these changes to…" — the first number changed on a job (owner,
 * 2026-10-12). What each of the client's jobs shows as its first number
 * after the change: its own `clientPhone`, else the profile's.
 *
 *  - This job only → the job keeps its own number; the profile and the other
 *    jobs stay as they are.
 *  - This job and the client profile → the profile takes the number; the
 *    other jobs that showed the old one keep showing it (pinned), so
 *    "existing jobs are untouched".
 *  - This job, the profile, and open jobs → as above, except the open and
 *    unpaid jobs that showed the old number take the new one; paid and
 *    closed jobs never change.
 */
import { JobSuperStatus, type Deal } from '@bitcrm/types';
import { changesWithClient, nextClientPhone } from 'src/deals/client-phone/client-phone.rules';
import { createMockDeal } from '../mocks';

const OLD = '+14045550100';
const NEW = '+14045550199';
const OWN = '+12035550123';

const job = (o: Partial<Deal> = {}) => createMockDeal({ id: 'other', ...o });
const edited = (o: Partial<Deal> = {}) => createMockDeal({ id: 'deal-1', ...o });
const change = (scope: 'job' | 'client' | 'open_jobs', previous: string | null = OLD) => ({
  dealId: 'deal-1',
  phone: NEW,
  previous: previous ?? undefined,
  scope,
});

describe('changesWithClient — the open, unpaid jobs', () => {
  it('takes a submitted, in-progress or pending job with nothing paid', () => {
    for (const superStatus of [JobSuperStatus.SUBMITTED, JobSuperStatus.IN_PROGRESS, JobSuperStatus.PENDING]) {
      expect(changesWithClient(job({ superStatus }))).toBe(true);
    }
  });

  it('never a closed job — done, canceled, or done pending approval', () => {
    for (const superStatus of [JobSuperStatus.DONE, JobSuperStatus.CANCELED, JobSuperStatus.DONE_PENDING_APPROVAL]) {
      expect(changesWithClient(job({ superStatus }))).toBe(false);
    }
  });

  it('never an open job paid in full', () => {
    expect(changesWithClient(job({ totals: { total: 120 } as Deal['totals'], amountPaid: 120 }))).toBe(false);
  });

  it('takes an open job still owing money, even partly paid', () => {
    expect(changesWithClient(job({ totals: { total: 120 } as Deal['totals'], amountPaid: 50 }))).toBe(true);
  });
});

describe('nextClientPhone — the edited job', () => {
  it('This job only: the job keeps the new number as its own', () => {
    expect(nextClientPhone(edited(), change('job'))).toBe(NEW);
  });

  it('This job only, back to the profile number: the override goes', () => {
    expect(nextClientPhone(edited({ clientPhone: OWN }), { ...change('job'), phone: OLD })).toBeNull();
  });

  it('applied to the profile: the job follows it (no override of its own)', () => {
    expect(nextClientPhone(edited({ clientPhone: OWN }), change('client'))).toBeNull();
    expect(nextClientPhone(edited({ clientPhone: OWN }), change('open_jobs'))).toBeNull();
  });

  it('applied to the profile on a job that came with Workiz numbers: the new one is written, so it wins over them', () => {
    expect(nextClientPhone(edited({ phones: [OLD] }), change('client'))).toBe(NEW);
  });

  it('leaves the row alone when nothing would change', () => {
    expect(nextClientPhone(edited(), change('client'))).toBeUndefined();
    expect(nextClientPhone(edited({ clientPhone: NEW }), change('job'))).toBeUndefined();
  });
});

describe('nextClientPhone — the client’s other jobs', () => {
  it('This job only never reaches them', () => {
    expect(nextClientPhone(job(), change('job'))).toBeUndefined();
  });

  it('This job and the profile: a job that showed the old number keeps it', () => {
    expect(nextClientPhone(job(), change('client'))).toBe(OLD);
  });

  it('This job and the profile: a job already pinned to the old number, or with its own, is untouched', () => {
    expect(nextClientPhone(job({ clientPhone: OLD }), change('client'))).toBeUndefined();
    expect(nextClientPhone(job({ clientPhone: OWN }), change('client'))).toBeUndefined();
  });

  it('open jobs: an open, unpaid job that showed the old number takes the new one', () => {
    expect(nextClientPhone(job(), change('open_jobs'))).toBeUndefined();
    expect(nextClientPhone(job({ clientPhone: OLD }), change('open_jobs'))).toBeNull();
    expect(nextClientPhone(job({ phones: [OLD] }), change('open_jobs'))).toBe(NEW);
  });

  it('open jobs: one with a number of its own keeps it', () => {
    expect(nextClientPhone(job({ clientPhone: OWN }), change('open_jobs'))).toBeUndefined();
  });

  it('open jobs: paid and closed jobs never change — they keep the old number', () => {
    expect(nextClientPhone(job({ superStatus: JobSuperStatus.DONE }), change('open_jobs'))).toBe(OLD);
    expect(
      nextClientPhone(job({ totals: { total: 80 } as Deal['totals'], amountPaid: 80 }), change('open_jobs')),
    ).toBe(OLD);
    expect(nextClientPhone(job({ superStatus: JobSuperStatus.CANCELED, clientPhone: OLD }), change('open_jobs'))).toBeUndefined();
  });

  it('a client with no number before has nothing to pin', () => {
    expect(nextClientPhone(job(), change('client', null))).toBeUndefined();
    expect(nextClientPhone(job({ superStatus: JobSuperStatus.DONE }), change('open_jobs', null))).toBeUndefined();
  });
});
