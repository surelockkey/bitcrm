/**
 * A job's own first number (`clientPhone`) is a client's number: crm hands
 * those only to `contacts.view_numbers`, so deal-service must not hand this
 * one to everybody with `deals.view`. Service-to-service reads (telephony
 * dials it) carry no signed-in user and get the whole job.
 */
import { lastValueFrom, of } from 'rxjs';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { DealsController } from 'src/deals/deals.controller';
import { DealBillingController } from 'src/deals/billing/deal-billing.controller';
import { JobNumberInterceptor, withoutJobNumber } from 'src/deals/job-number.interceptor';
import { createMockDeal } from '../mocks';

const context = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
const through = (request: object, body: unknown) =>
  lastValueFrom(new JobNumberInterceptor().intercept(context(request), { handle: () => of(body) }));

const job = createMockDeal({ id: 'd1', clientPhone: '+12035550123' });
const viewer = (view_numbers: boolean) => ({
  user: { id: 'u-1' },
  resolvedPermissions: { permissions: { contacts: { view_numbers } } },
});

describe('withoutJobNumber', () => {
  it('drops the number from a job, a list of jobs, and a job inside an answer', () => {
    expect(withoutJobNumber({ success: true, data: job }).data).not.toHaveProperty('clientPhone');
    expect(withoutJobNumber({ success: true, data: [job, job] }).data[1]).not.toHaveProperty('clientPhone');
    expect(withoutJobNumber({ success: true, data: { deal: job, otherJobsChanged: 0 } }).data.deal).not.toHaveProperty(
      'clientPhone',
    );
  });

  it('keeps everything else', () => {
    expect(withoutJobNumber({ success: true, data: job }).data).toEqual({ ...job, clientPhone: undefined });
    expect(withoutJobNumber({ success: true, data: { id: 'x' }, pagination: { count: 1 } })).toEqual({
      success: true,
      data: { id: 'x' },
      pagination: { count: 1 },
    });
  });
});

describe('JobNumberInterceptor', () => {
  const body = { success: true, data: job };

  it('a caller without contacts.view_numbers gets the job without its number', async () => {
    expect(((await through(viewer(false), body)) as typeof body).data).not.toHaveProperty('clientPhone');
  });

  it('a caller with it gets the number', async () => {
    expect(((await through(viewer(true), body)) as typeof body).data.clientPhone).toBe('+12035550123');
  });

  it('a service-to-service read (no signed-in user) gets the whole job', async () => {
    expect(((await through({}, body)) as typeof body).data.clientPhone).toBe('+12035550123');
  });

  it('guards every route of the jobs and job-billing controllers', () => {
    for (const controller of [DealsController, DealBillingController]) {
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, controller)).toContain(JobNumberInterceptor);
    }
  });
});
