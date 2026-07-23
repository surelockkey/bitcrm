import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DealStage } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { JobTypesService } from 'src/job-types/job-types.service';
import { JobSourcesService } from 'src/job-sources/job-sources.service';
import { JobTagsService } from 'src/job-tags/job-tags.service';
import { TechnicianEligibilityRepository } from 'src/technician-eligibility/technician-eligibility.repository';
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
  createMockJobType,
  createMockJobSource,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

/**
 * A deal carries many technicians as equal peers. These guard the roster diff
 * (add/remove in one call), the per-technician sequence bookkeeping, and the
 * fact that removing one technician leaves the others untouched.
 */
describe('DealsService — multi-technician assignment', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;

  const caller = createMockJwtUser({ id: 'dispatcher-1' });

  beforeEach(async () => {
    repo = createMockDealsRepository();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: createMockDealsCacheService() },
        { provide: TimelineRepository, useValue: createMockTimelineRepository() },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const rosterWrite = () =>
    repo.update.mock.calls.find(([, u]: [string, any]) => u.assignedTechIds !== undefined)?.[1];

  it('assigns three technicians in one call', async () => {
    const deal = createMockDeal({ assignedTechIds: [], stage: DealStage.NEW_LEAD });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);

    await service.assignTechs('deal-1', ['a', 'b', 'c'], caller);

    expect(repo.addAssignment).toHaveBeenCalledTimes(3);
    expect(rosterWrite().assignedTechIds).toEqual(['a', 'b', 'c']);
  });

  it('adds and removes in a single roster diff, touching only the delta', async () => {
    const deal = createMockDeal({
      assignedTechIds: ['a', 'b'],
      sequences: { a: 1, b: 2 },
      stage: DealStage.ASSIGNED,
    });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);

    // b drops off, c joins; a is untouched.
    await service.assignTechs('deal-1', ['a', 'c'], caller);

    expect(repo.addAssignment).toHaveBeenCalledTimes(1);
    expect(repo.addAssignment).toHaveBeenCalledWith('deal-1', 'c', expect.anything(), 'dispatcher-1');
    expect(repo.removeAssignment).toHaveBeenCalledTimes(1);
    expect(repo.removeAssignment).toHaveBeenCalledWith('deal-1', 'b');

    const write = rosterWrite();
    expect(write.assignedTechIds).toEqual(['a', 'c']);
    // The removed tech's sequence entry goes; the kept one survives.
    expect(write.sequences).toEqual({ a: 1 });
  });

  it('is a no-op when the roster is unchanged', async () => {
    const deal = createMockDeal({ assignedTechIds: ['a', 'b'] });
    repo.findById.mockResolvedValue(deal);

    await service.assignTechs('deal-1', ['b', 'a'], caller);

    expect(repo.addAssignment).not.toHaveBeenCalled();
    expect(repo.removeAssignment).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('unassigning one technician leaves the rest on the deal', async () => {
    const deal = createMockDeal({
      assignedTechIds: ['a', 'b', 'c'],
      sequences: { a: 1, b: 2, c: 3 },
    });
    repo.findById.mockResolvedValue(deal);
    repo.update.mockResolvedValue(deal);

    await service.unassignTech('deal-1', 'b', caller);

    expect(repo.removeAssignment).toHaveBeenCalledWith('deal-1', 'b');
    const write = rosterWrite();
    expect(write.assignedTechIds).toEqual(['a', 'c']);
    expect(write.sequences).toEqual({ a: 1, c: 3 });
  });
});
