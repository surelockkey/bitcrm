/**
 * What the job's Timeline and Reports → Activity need written with an event to
 * say it in Workiz's words (GAP_PLAN C8, 2026-10-12):
 *
 * - a reschedule is ONE sentence in Workiz ("Rescheduled job from Wed Oct 07
 *   2026 5:00 pm - 6:00 pm to Thu Oct 08 2026 8:00 am - 9:00 am"), so one save
 *   that moves the visit writes one entry carrying the whole visit before and
 *   after — not one entry per field of it;
 * - "Tech Assigned - (2) TX - Daniel Munoz" names the technician, so the
 *   assignment entries carry the name the technician had when it happened.
 */
import { TimelineEventType } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockGeocodingService,
  createMockInternalHttpService,
  createMockJobType,
  createMockJwtUser,
  createMockCustomFieldsService,
  createMockTechnicianEligibilityRepository,
  createMockTimelineRepository,
} from '../mocks';

function makeService() {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const timeline = createMockTimelineRepository();
  const eligibility = createMockTechnicianEligibilityRepository();
  const serviceAreas = { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() };
  const stub = {} as any;
  const service = new DealsService(
    repo as any,
    cache as any,
    timeline as any,
    stub,
    createMockInternalHttpService() as any,
    createMockGeocodingService() as any,
    serviceAreas as any,
    { findById: jest.fn().mockResolvedValue(createMockJobType()) } as any,
    stub,
    stub,
    { list: jest.fn().mockResolvedValue([]) } as any,
    stub,
    createMockCustomFieldsService() as any,
    eligibility as any,
  );
  cache.get.mockResolvedValue(null);
  return { service, repo, timeline, eligibility, serviceAreas };
}

const caller = createMockJwtUser({ id: 'dispatcher-1' });

type Entry = { eventType: string; details: Record<string, any> };
const entries = (timeline: ReturnType<typeof createMockTimelineRepository>): Entry[] =>
  timeline.addEntry.mock.calls.map(([entry]: [Entry]) => entry);
const fieldEntries = (timeline: ReturnType<typeof createMockTimelineRepository>) =>
  entries(timeline).filter((e) => e.eventType === TimelineEventType.FIELD_UPDATED);

describe('a reschedule on the timeline', () => {
  it('is one entry with the whole visit before and after, whatever parts of it moved', async () => {
    const { service, repo, timeline } = makeService();
    const existing = createMockDeal({
      scheduledDate: '2026-10-07',
      scheduledEndDate: '2026-10-07',
      scheduledTimeSlot: '17:00-18:00',
    });
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(existing);

    await service.update(
      'deal-1',
      { scheduledDate: '2026-10-08', scheduledEndDate: '2026-10-08', scheduledTimeSlot: '08:00-09:00' } as any,
      caller,
    );

    const fields = fieldEntries(timeline);
    expect(fields).toHaveLength(1);
    expect(fields[0].details).toEqual({
      field: 'schedule',
      // Each visit says the clock it is on — the Activity text reads it onto Connecticut's.
      oldValue: { date: '2026-10-07', endDate: '2026-10-07', slot: '17:00-18:00', allDay: null, timezone: 'America/New_York' },
      newValue: { date: '2026-10-08', endDate: '2026-10-08', slot: '08:00-09:00', allDay: null, timezone: 'America/New_York' },
    });
  });

  it('writes each visit with the clock it is on: the job’s own zone, else its area’s', async () => {
    const { service, repo, timeline, serviceAreas } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-07', scheduledTimeSlot: '17:00-18:00', serviceAreaId: 'area-tx' } as any);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(existing);
    serviceAreas.findById.mockResolvedValue({ id: 'area-tx', timezone: 'America/Chicago' });

    await service.update('deal-1', { scheduledTimeSlot: '18:00-19:00' } as any, caller);
    const [entry] = fieldEntries(timeline);
    expect(entry.details.oldValue.timezone).toBe('America/Chicago');
    expect(entry.details.newValue.timezone).toBe('America/Chicago');

    timeline.addEntry.mockClear();
    repo.findById.mockResolvedValue({ ...existing, jobTimezone: 'America/Denver' });
    await service.update('deal-1', { scheduledTimeSlot: '19:00-20:00' } as any, caller);
    expect(fieldEntries(timeline)[0].details.oldValue.timezone).toBe('America/Denver');
  });

  it('keeps the parts that did not move in the visit it names', async () => {
    const { service, repo, timeline } = makeService();
    const existing = createMockDeal({
      scheduledDate: '2026-10-07',
      scheduledEndDate: '2026-10-07',
      scheduledTimeSlot: '17:00-18:00',
    });
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(existing);

    // The time alone: the day stays.
    await service.update('deal-1', { scheduledTimeSlot: '18:00-19:00' } as any, caller);

    expect(fieldEntries(timeline).map((e) => e.details)).toEqual([
      {
        field: 'schedule',
        oldValue: { date: '2026-10-07', endDate: '2026-10-07', slot: '17:00-18:00', allDay: null, timezone: 'America/New_York' },
        newValue: { date: '2026-10-07', endDate: '2026-10-07', slot: '18:00-19:00', allDay: null, timezone: 'America/New_York' },
      },
    ]);
  });

  it('logs an unscheduled visit as one entry too, the Workiz instants that go with it unlogged', async () => {
    const { service, repo, timeline } = makeService();
    const existing = createMockDeal({
      scheduledDate: '2026-10-08',
      scheduledTimeSlot: '08:00-09:00',
      jobDateUtc: '2026-10-08T12:00:00Z',
      jobEndDateUtc: '2026-10-08T13:00:00Z',
    } as any);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, scheduledDate: undefined });

    await service.update('deal-1', { scheduledDate: null } as any, caller);

    const fields = fieldEntries(timeline);
    expect(fields.map((e) => e.details.field)).toEqual(['schedule']);
    // No visit, no clock.
    expect(fields[0].details.newValue).toEqual({ date: null, endDate: null, slot: null, allDay: null });
  });

  it('still logs the other fields of the same save one by one', async () => {
    const { service, repo, timeline } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-07', scheduledTimeSlot: '17:00-18:00', notes: 'old' });
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(existing);

    await service.update('deal-1', { scheduledDate: '2026-10-09', notes: 'new' } as any, caller);

    expect(fieldEntries(timeline).map((e) => e.details.field).sort()).toEqual(['notes', 'schedule']);
  });

  it('writes nothing about the visit when the save left it where it was', async () => {
    const { service, repo, timeline } = makeService();
    const existing = createMockDeal({ scheduledDate: '2026-10-07', scheduledTimeSlot: '17:00-18:00', notes: 'old' });
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue(existing);

    await service.update('deal-1', { scheduledDate: '2026-10-07', scheduledTimeSlot: '17:00-18:00', notes: 'new' } as any, caller);

    expect(fieldEntries(timeline).map((e) => e.details.field)).toEqual(['notes']);
  });
});

describe('a technician assigned or taken off, on the timeline', () => {
  it("carries the technician's Workiz name, else their own", async () => {
    const { service, repo, timeline, eligibility } = makeService();
    const deal = createMockDeal({ assignedTechIds: ['tech-old'] });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);
    eligibility.getMany.mockResolvedValue([
      { technicianId: 'tech-new', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz' },
      { technicianId: 'tech-old', firstName: 'Samer', lastName: 'Alkofahi' },
    ]);

    await service.assignTechs('deal-1', ['tech-new'], caller);

    const byType = Object.fromEntries(entries(timeline).map((e) => [e.eventType, e.details]));
    expect(byType[TimelineEventType.TECH_ASSIGNED]).toEqual({ techId: 'tech-new', techName: '(2) TX - Daniel Munoz' });
    expect(byType[TimelineEventType.TECH_UNASSIGNED]).toEqual({ previousTechId: 'tech-old', techName: 'Samer Alkofahi' });
  });

  it('names the technician taken off one by one', async () => {
    const { service, repo, timeline, eligibility } = makeService();
    const deal = createMockDeal({ assignedTechIds: ['tech-old'] });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);
    eligibility.getMany.mockResolvedValue([{ technicianId: 'tech-old', workizName: '(2) TX - Samer Alkofahi' }]);

    await service.unassignTech('deal-1', 'tech-old', caller);

    const off = entries(timeline).find((e) => e.eventType === TimelineEventType.TECH_UNASSIGNED);
    expect(off?.details).toEqual({ previousTechId: 'tech-old', techName: '(2) TX - Samer Alkofahi' });
  });

  it('still records the assignment, unnamed, when the names cannot be read', async () => {
    const { service, repo, timeline, eligibility } = makeService();
    const deal = createMockDeal({ assignedTechIds: [] });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);
    eligibility.getMany.mockRejectedValue(new Error('throttled'));

    await service.assignTechs('deal-1', ['tech-new'], caller);

    const on = entries(timeline).find((e) => e.eventType === TimelineEventType.TECH_ASSIGNED);
    expect(on?.details).toEqual({ techId: 'tech-new' });
  });
});
