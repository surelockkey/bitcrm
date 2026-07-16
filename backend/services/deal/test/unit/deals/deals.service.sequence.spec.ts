import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DealStage } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import {
  createMockDeal,
  createMockJwtUser,
  createMockDealsRepository,
  createMockDealsCacheService,
  createMockTimelineRepository,
  createMockDealProductsRepository,
  createMockSnsPublisherService,
  createMockInternalHttpService,
  createMockGeocodingService,
} from '../mocks';

/**
 * A technician's jobs carry a sequence number — the order they visit them,
 * earliest scheduled first ([1], [2], [3]). Nothing wrote it before; these are
 * the guards for writing it on assignment and on manual reorder.
 */
describe('DealsService — job sequencing', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;

  const caller = createMockJwtUser();
  const TODAY = '2026-07-16';

  beforeEach(async () => {
    repo = createMockDealsRepository();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: createMockDealsCacheService() },
        { provide: TimelineRepository, useValue: createMockTimelineRepository() },
        {
          provide: DealProductsRepository,
          useValue: createMockDealProductsRepository(),
        },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  /** The sequenceNumber written to each deal id by repo.update. */
  function sequenceWrites(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, updates] of repo.update.mock.calls) {
      if (updates.sequenceNumber !== undefined) out[id] = updates.sequenceNumber;
    }
    return out;
  }

  /** Mock the tech's active deals for the day (drained findByTech). */
  function techHasDeals(deals: ReturnType<typeof createMockDeal>[]) {
    repo.findByTech.mockResolvedValue({ items: deals, nextCursor: undefined });
  }

  describe('assignTech', () => {
    it('numbers the technician’s jobs by scheduled time, earliest first', async () => {
      const target = createMockDeal({ id: 'pm', scheduledDate: TODAY, scheduledTimeSlot: '15:00-18:00' });
      repo.findById.mockResolvedValue(target);
      repo.update.mockImplementation(async (_id: string, u: any) => ({ ...target, ...u }));
      techHasDeals([
        createMockDeal({ id: 'am', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '09:00-12:00' }),
        createMockDeal({ id: 'pm', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '15:00-18:00' }),
        createMockDeal({ id: 'noon', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '12:00-15:00' }),
      ]);

      await service.assignTech('pm', { techId: 'tech-1' } as any, caller);

      expect(sequenceWrites()).toMatchObject({ am: 1, noon: 2, pm: 3 });
    });

    it('excludes completed/canceled jobs from the sequence', async () => {
      const target = createMockDeal({ id: 'a', scheduledDate: TODAY, scheduledTimeSlot: '09:00-12:00' });
      repo.findById.mockResolvedValue(target);
      repo.update.mockImplementation(async (_id: string, u: any) => ({ ...target, ...u }));
      techHasDeals([
        createMockDeal({ id: 'a', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '09:00-12:00' }),
        createMockDeal({ id: 'done', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '10:00-11:00', stage: DealStage.COMPLETED }),
        createMockDeal({ id: 'b', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '13:00-15:00' }),
      ]);

      await service.assignTech('a', { techId: 'tech-1' } as any, caller);

      const writes = sequenceWrites();
      expect(writes).toMatchObject({ a: 1, b: 2 });
      expect(writes.done).toBeUndefined();
    });
  });

  describe('unassignTech', () => {
    it('renumbers the previous technician’s remaining jobs', async () => {
      const target = createMockDeal({ id: 'gone', assignedTechId: 'tech-1', scheduledDate: TODAY });
      repo.findById.mockResolvedValue(target);
      repo.update.mockImplementation(async (_id: string, u: any) => ({ ...target, ...u }));
      // After unassign, only these two remain with the tech.
      techHasDeals([
        createMockDeal({ id: 'keep-2', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '14:00-16:00' }),
        createMockDeal({ id: 'keep-1', assignedTechId: 'tech-1', scheduledDate: TODAY, scheduledTimeSlot: '09:00-11:00' }),
      ]);

      await service.unassignTech('gone', caller);

      expect(sequenceWrites()).toMatchObject({ 'keep-1': 1, 'keep-2': 2 });
    });
  });

  describe('reorderSchedule', () => {
    it('writes the sequence in the given order', async () => {
      techHasDeals([
        createMockDeal({ id: 'x', assignedTechId: 'tech-1' }),
        createMockDeal({ id: 'y', assignedTechId: 'tech-1' }),
        createMockDeal({ id: 'z', assignedTechId: 'tech-1' }),
      ]);
      repo.update.mockImplementation(async (_id: string, u: any) => u);

      await service.reorderSchedule({ techId: 'tech-1', orderedDealIds: ['z', 'x', 'y'] }, caller);

      expect(sequenceWrites()).toMatchObject({ z: 1, x: 2, y: 3 });
    });

    it('ignores deal ids that are not the technician’s', async () => {
      techHasDeals([createMockDeal({ id: 'mine', assignedTechId: 'tech-1' })]);
      repo.update.mockImplementation(async (_id: string, u: any) => u);

      await service.reorderSchedule(
        { techId: 'tech-1', orderedDealIds: ['someone-elses', 'mine'] },
        caller,
      );

      expect(sequenceWrites()).toEqual({ mine: 1 });
    });
  });
});
