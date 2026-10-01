import { Test } from '@nestjs/testing';
import { ClientType, TimelineEventType } from '@bitcrm/types';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { JobTypesService } from 'src/job-types/job-types.service';
import { JobSourcesService } from 'src/job-sources/job-sources.service';
import { ExternalCompaniesService } from 'src/external-companies/external-companies.service';
import { JobTagsService } from 'src/job-tags/job-tags.service';
import { JobStatusesService } from 'src/job-statuses/job-statuses.service';
import { TechnicianEligibilityRepository } from 'src/technician-eligibility/technician-eligibility.repository';
import { CustomFieldsService } from 'src/custom-fields/custom-fields.service';
import { JobFieldSettingsService } from 'src/job-field-settings/job-field-settings.service';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import {
  createMockCustomFieldsService,
  createMockDeal,
  createMockDealProductsRepository,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockExternalCompany,
  createMockGeocodingService,
  createMockInternalHttpService,
  createMockJobSource,
  createMockJobType,
  createMockJwtUser,
  createMockSnsPublisherService,
  createMockTechnicianEligibilityRepository,
  createMockTimelineRepository,
} from '../mocks';

/**
 * Every event a job writes is filed under the job's client (GSI10
 * ContactActivityIndex), which is what the client card's History reads. The
 * writers know the deal, so the entry must carry `contactId` — on the paths
 * that already hold the deal without a second read, and on the ones that only
 * have an id, through the cached lookup.
 */
describe('DealsService — timeline entries carry the job’s contactId', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  const caller = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    timeline = createMockTimelineRepository();
    http = createMockInternalHttpService();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: http },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn().mockResolvedValue(createMockExternalCompany()) } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: JobFieldSettingsService, useValue: { missingRequiredForCreate: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const entries = () => timeline.addEntry.mock.calls.map((c) => c[0]);

  it('create: the "created" event names the new job’s client without re-reading the job', async () => {
    http.validateContact.mockResolvedValue(true);
    repo.reserveDealNumber?.mockResolvedValue?.('AB12CD');

    await service.create(
      {
        contactId: 'contact-7',
        clientType: ClientType.RESIDENTIAL,
        serviceArea: 'Atlanta Metro',
        address: { street: '123 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
        jobTypeId: 'jobtype-1',
      } as any,
      caller,
    );

    expect(entries()).toEqual([
      expect.objectContaining({ eventType: TimelineEventType.CREATED, contactId: 'contact-7' }),
    ]);
    // The deal was just built in memory — no lookup needed for its client.
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('addNote: an id-only path resolves the client through the cached job', async () => {
    cache.get.mockResolvedValue(createMockDeal({ id: 'deal-1', contactId: 'contact-9' }));

    await service.addNote('deal-1', { note: 'Called back' }, caller);

    expect(entries()).toEqual([
      expect.objectContaining({ eventType: TimelineEventType.NOTE_ADDED, note: 'Called back', contactId: 'contact-9' }),
    ]);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('recordCallLink: the call event is filed under the client', async () => {
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1', contactId: 'contact-9' }));

    await service.recordCallLink('deal-1', true, { callSid: 'CA1' }, { id: 'agent-1', name: 'Agent' });

    expect(entries()).toEqual([
      expect.objectContaining({ eventType: TimelineEventType.CALL_LINKED, contactId: 'contact-9' }),
    ]);
  });

  it('updatePaymentStatus: uses the client of the job the update returned (no extra read)', async () => {
    repo.update.mockResolvedValue(createMockDeal({ id: 'deal-1', contactId: 'contact-9' }));

    await service.updatePaymentStatus('deal-1', { paymentStatus: 'paid', amountPaid: 100 } as any);

    expect(entries()).toEqual([
      expect.objectContaining({ eventType: TimelineEventType.FIELD_UPDATED, contactId: 'contact-9' }),
    ]);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('reassignContact (merge): the move is filed under the client the job now belongs to', async () => {
    repo.findByContact.mockResolvedValue({
      items: [createMockDeal({ id: 'deal-1', contactId: 'old-c' }), createMockDeal({ id: 'deal-2', contactId: 'old-c' })],
      nextCursor: undefined,
    });

    await service.reassignContact('old-c', 'new-c');

    expect(entries().map((e) => [e.dealId, e.contactId])).toEqual([
      ['deal-1', 'new-c'],
      ['deal-2', 'new-c'],
    ]);
  });

  it('a job with no client (imported orphan) writes the event without contactId — the key stays sparse', async () => {
    repo.update.mockResolvedValue({ ...createMockDeal({ id: 'deal-1' }), contactId: undefined } as any);

    await service.updatePaymentStatus('deal-1', { paymentStatus: 'paid', amountPaid: 100 } as any);

    expect(entries()).toHaveLength(1);
    expect(entries()[0].contactId).toBeUndefined();
  });

  it('a failed client lookup on an id-only path never blocks the event itself', async () => {
    // moveStatus-style paths read the job first; here the job read succeeds
    // and only the cached re-read for the client fails.
    cache.get
      .mockResolvedValueOnce(createMockDeal({ id: 'deal-1', contactId: 'contact-9' }))
      .mockRejectedValue(new Error('redis down'));
    repo.findById.mockRejectedValue(new Error('dynamo down'));

    await service.addNote('deal-1', { note: 'Called back' }, caller);

    expect(entries()).toEqual([expect.objectContaining({ eventType: TimelineEventType.NOTE_ADDED })]);
  });
});
