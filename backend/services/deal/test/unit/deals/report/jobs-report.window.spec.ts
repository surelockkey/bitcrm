/**
 * The report end to end without DynamoDB: `JobsReportService` over a real
 * `DealsRepository` whose table is the three report indexes in memory
 * (`scripts/jobs-report-in-memory.ts`). What this pins down is the edges —
 * that each "By:" window's key range and the exact Eastern-day filter
 * together keep exactly the right jobs.
 */
import { JOBS_REPORT_DEFAULT_SETTINGS, type JobsReportBy, type ResolvedPermissions } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { JobsReportService } from 'src/deals/report/jobs-report.service';
import type { JobsReportQueryDto } from 'src/deals/report/jobs-report.query';
import { InMemoryReportIndexes } from 'src/scripts/jobs-report-in-memory';

const row = (id: string, over: Record<string, unknown>): Record<string, unknown> => ({
  PK: `DEAL#${id}`,
  SK: 'METADATA',
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  contactId: 'c',
  superStatus: 'done',
  createdAt: '2026-08-15T12:00:00.000Z',
  totals: { total: 1 },
  ...over,
});

const ROWS = [
  // Created 23:30 Eastern on the 27th — 03:30 UTC on the 28th.
  row('lateCreated', { createdAt: '2026-09-28T03:30:00.000Z', scheduledDate: '2026-10-05', scheduledEndDate: '2026-10-05' }),
  // Created 23:59 Eastern on Aug 31 — already Sep 1 in UTC.
  row('earlyCreated', { createdAt: '2026-09-01T03:59:00.000Z', scheduledDate: '2026-10-05', scheduledEndDate: '2026-10-05' }),
  // A Dallas visit at 23:30 Central on the 27th is 00:30 Eastern on the 28th — out.
  row('lateCentral', {
    scheduledDate: '2026-09-27',
    scheduledEndDate: '2026-09-27',
    scheduledTimeSlot: '23:30-23:45',
    jobTimezone: 'America/Chicago',
    jobDateUtc: '2026-09-28T04:30:00.000Z',
    jobEndDateUtc: '2026-09-28T04:45:00.000Z',
  }),
  // …and one at 23:30 Central on Aug 31 is 00:30 Eastern on Sep 1 — in, found through the day of margin.
  row('edgeCentral', {
    scheduledDate: '2026-08-31',
    scheduledEndDate: '2026-08-31',
    scheduledTimeSlot: '23:30-23:45',
    jobTimezone: 'America/Chicago',
    jobDateUtc: '2026-09-01T04:30:00.000Z',
    jobEndDateUtc: '2026-09-01T04:45:00.000Z',
  }),
  // Started in July, ends in the window: on the end date only.
  row('multiDay', { scheduledDate: '2026-07-01', scheduledEndDate: '2026-09-10', scheduledTimeSlot: '09:00-17:00' }),
  // No date at all: reports on its creation (Workiz's hidden slot).
  row('undated', { superStatus: 'pending', createdAt: '2026-09-05T15:00:00.000Z' }),
  row('deleted', { status: 'deleted', scheduledDate: '2026-09-10', scheduledEndDate: '2026-09-10' }),
  row('stub', { isStub: true, scheduledDate: '2026-09-10', scheduledEndDate: '2026-09-10' }),
  row('plain', { superStatus: 'canceled', createdAt: '2026-09-02T12:00:00.000Z', scheduledDate: '2026-09-02', scheduledEndDate: '2026-09-02' }),
];

describe('Jobs report windows through the repository', () => {
  const perms = { roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
  let service: JobsReportService;

  beforeEach(() => {
    const indexes = new InMemoryReportIndexes(ROWS);
    const catalog = { list: async () => [] };
    service = new JobsReportService(
      new DealsRepository(indexes.dynamoDb as never),
      { get: async () => JOBS_REPORT_DEFAULT_SETTINGS } as never,
      { getUserNamesBatch: async () => [], getContactNames: async () => [], getContactsAsCaller: async () => [] } as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
    );
  });

  const ids = async (by: JobsReportBy) =>
    (
      await service.page({ by, from: '2026-09-01', to: '2026-09-27', sort: 'jobNumber', dir: 'asc' } as JobsReportQueryDto, {
        user: { id: 'u' } as never,
        perms,
      })
    ).rows.map((r) => r.id);

  it('by created: the Eastern days, exactly', async () => {
    expect(await ids('created')).toEqual(['lateCreated', 'plain', 'undated']);
  });

  it('by job date: the visit start on the Eastern clock, undated jobs by creation', async () => {
    expect(await ids('scheduled')).toEqual(['edgeCentral', 'plain', 'undated']);
  });

  it('by job end date: the visit end — a July start ending in September is in', async () => {
    expect(await ids('end')).toEqual(['edgeCentral', 'multiDay', 'plain', 'undated']);
  });
});
