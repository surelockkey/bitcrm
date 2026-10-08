/**
 * Workiz's "Scheduled" toggle on the New Job page: a job may be created with
 * no visit at all (it lands in the Unscheduled tab), scheduled later, and
 * unscheduled again from the job page. Unscheduling is `scheduledDate: null`;
 * the rest of the visit (end date, time slot, all-day) goes with it, and so
 * do the Workiz visit instants an imported job carries — otherwise the Jobs
 * report would keep filing the job on its old Workiz time.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientType, TimelineEventType } from '@bitcrm/types';
import { UpdateDealDto } from 'src/deals/dto/update-deal.dto';
import { DealsService } from 'src/deals/deals.service';
import { statusScheduleKeys } from 'src/deals/deals.repository';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockGeocodingService,
  createMockInternalHttpService,
  createMockJobType,
  createMockJwtUser,
  createMockCustomFieldsService,
  createMockTimelineRepository,
} from '../mocks';

function makeService() {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const timeline = createMockTimelineRepository();
  const stub = {} as any;
  const service = new DealsService(
    repo as any,
    cache as any,
    timeline as any,
    stub,
    createMockInternalHttpService() as any,
    createMockGeocodingService() as any,
    { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() } as any,
    { findById: jest.fn().mockResolvedValue(createMockJobType()) } as any,
    stub,
    stub,
    { list: jest.fn().mockResolvedValue([]) } as any,
    stub,
    createMockCustomFieldsService() as any,
    stub,
  );
  return { service, repo, cache, timeline };
}

const caller = createMockJwtUser({ id: 'dispatcher-1' });

describe('a job with no visit', () => {
  it('is created without dates and files under UNSCHED on the schedule index', async () => {
    const { service, repo } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');

    const deal = await service.create(
      {
        contactId: 'contact-1',
        clientType: ClientType.RESIDENTIAL,
        address: { street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
        jobTypeId: 'jobtype-1',
      } as any,
      caller,
    );

    expect(deal.scheduledDate).toBeUndefined();
    expect(deal.scheduledTimeSlot).toBeUndefined();
    expect(statusScheduleKeys(deal).GSI5SK.startsWith('UNSCHED#')).toBe(true);
  });

  it('the update DTO takes null for every part of the visit', async () => {
    const errors = await validate(
      plainToInstance(UpdateDealDto, { scheduledDate: null, scheduledEndDate: null, scheduledTimeSlot: null }),
    );
    expect(errors).toEqual([]);
  });
});

describe('unscheduling a job', () => {
  it('scheduledDate: null clears the whole visit', async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({
      scheduledDate: '2026-10-08',
      scheduledEndDate: '2026-10-08',
      scheduledTimeSlot: '08:00-09:00',
    });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    const [, updates] = repo.update.mock.calls[0];
    expect(updates).toMatchObject({ scheduledDate: null, scheduledEndDate: null, scheduledTimeSlot: null });
  });

  it("clears an imported job's Workiz visit instants too, so the report stops filing it on them", async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-08', scheduledTimeSlot: '08:00-09:00' });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    const [, updates] = repo.update.mock.calls[0];
    expect(updates).toMatchObject({ jobDateUtc: null, jobEndDateUtc: null });
  });

  it('drops the all-day flag of an all-day visit', async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-08', scheduledTimeSlot: undefined, allDay: true });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined, allDay: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    expect(repo.update.mock.calls[0][1]).toMatchObject({ allDay: null });
  });

  it('logs what was cleared and nothing that was already empty', async () => {
    const { service, repo, cache, timeline } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-08', scheduledTimeSlot: '08:00-09:00' });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    const fields = timeline.addEntry.mock.calls
      .map(([entry]: [{ eventType: string; details: { field: string } }]) => entry)
      .filter((e) => e.eventType === TimelineEventType.FIELD_UPDATED)
      .map((e) => e.details.field)
      .sort();
    expect(fields).toEqual(['scheduledDate', 'scheduledTimeSlot']);
  });

  it("re-stamps the technicians' assignment rows as undated", async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-08', assignedTechIds: [] });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    expect(repo.restampAssignmentDates).toHaveBeenCalledWith('deal-1', null, 'dispatcher-1');
  });
});
