import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DealStatus, TimelineEventType } from '@bitcrm/types';
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
  createMockCustomFieldsService,
} from '../mocks';

/**
 * Workiz "Send to tech" + "seen": the click stamps the job and each
 * technician's assignment row, logs the activity and hands delivery to
 * messaging over `deal.sent_to_tech`; the technician's app marks the job
 * seen once; messaging reports per-channel outcomes back.
 */
describe('DealsService — send to tech / seen', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let cache: ReturnType<typeof createMockDealsCacheService>;

  const dispatcher = createMockJwtUser({ id: 'dispatcher-1', email: 'disp@test.com' });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    timeline = createMockTimelineRepository();
    sns = createMockSnsPublisherService();
    cache = createMockDealsCacheService();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: createMockDealProductsRepository() },
        { provide: SnsPublisherService, useValue: sns },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn() } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn() } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const stampedWrite = () =>
    repo.update.mock.calls.find(([, u]: [string, any]) => u.sentToTechAt !== undefined)?.[1];

  describe('sendToTech', () => {
    it('stamps the job and every assignment row, logs the activity and publishes deal.sent_to_tech', async () => {
      const deal = createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.sendToTech('deal-1', { channels: ['sms', 'in_app'] }, dispatcher);

      const write = stampedWrite();
      expect(write).toMatchObject({ sentToTechVia: ['sms', 'in_app'], sentToTechBy: 'dispatcher-1' });
      expect(typeof write.sentToTechAt).toBe('string');

      // Omitted techIds = the whole roster, each row stamped with the same click.
      expect(repo.markAssignmentsSent).toHaveBeenCalledWith('deal-1', ['tech-1', 'tech-2'], {
        sentAt: write.sentToTechAt,
        sentVia: ['sms', 'in_app'],
        sentBy: 'dispatcher-1',
      });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          dealId: 'deal-1',
          eventType: TimelineEventType.SENT_TO_TECH,
          actorId: 'dispatcher-1',
          details: { techIds: ['tech-1', 'tech-2'], channels: ['sms', 'in_app'], sentAt: write.sentToTechAt },
        }),
      );

      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.sent_to_tech', {
        dealId: 'deal-1',
        dealNumber: 'AB12CD',
        techIds: ['tech-1', 'tech-2'],
        channels: ['sms', 'in_app'],
        sentAt: write.sentToTechAt,
        sentBy: 'dispatcher-1',
      });
    });

    it('narrows to the named technicians and de-duplicates channels', async () => {
      const deal = createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.sendToTech('deal-1', { channels: ['sms', 'sms'] as any, techIds: ['tech-2'] }, dispatcher);

      expect(repo.markAssignmentsSent).toHaveBeenCalledWith('deal-1', ['tech-2'], expect.objectContaining({ sentVia: ['sms'] }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.sent_to_tech', expect.objectContaining({ techIds: ['tech-2'], channels: ['sms'] }));
    });

    it('refuses a technician who is not on the roster, an unassigned job and a deleted job', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'] }));
      await expect(
        service.sendToTech('deal-1', { channels: ['sms'], techIds: ['tech-9'] }, dispatcher),
      ).rejects.toThrow(BadRequestException);

      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: [] }));
      await expect(service.sendToTech('deal-1', { channels: ['sms'] }, dispatcher)).rejects.toThrow(
        'Assign a technician before sending the job',
      );

      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'], status: DealStatus.DELETED }));
      await expect(service.sendToTech('deal-1', { channels: ['sms'] }, dispatcher)).rejects.toThrow(BadRequestException);

      expect(repo.update).not.toHaveBeenCalled();
      expect(sns.publish).not.toHaveBeenCalled();
    });

    // The stamp is what the job page, the list and the dispatch board read as
    // "this went out". It must never outlive the event that makes it true.
    it('stamps the assignment rows before the job, and leaves the job unsent when they fail', async () => {
      const deal = createMockDeal({ assignedTechIds: ['tech-1'] });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.sendToTech('deal-1', { channels: ['sms'] }, dispatcher);
      expect(repo.markAssignmentsSent.mock.invocationCallOrder[0]).toBeLessThan(
        repo.update.mock.invocationCallOrder[0],
      );

      jest.clearAllMocks();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);
      repo.markAssignmentsSent.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      await expect(service.sendToTech('deal-1', { channels: ['sms'] }, dispatcher)).rejects.toThrow(
        'ProvisionedThroughputExceededException',
      );

      // Nothing said "Sent": no stamp, no activity entry, no event for messaging.
      expect(stampedWrite()).toBeUndefined();
      expect(timeline.addEntry).not.toHaveBeenCalled();
      expect(sns.publish).not.toHaveBeenCalled();
    });

    it('pressing again is a resend: a fresh sentAt, another timeline entry and event', async () => {
      const deal = createMockDeal({
        assignedTechIds: ['tech-1'],
        sentToTechAt: '2026-04-16T09:00:00.000Z',
        sentToTechVia: ['sms'],
        sentToTechBy: 'dispatcher-0',
      });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.sendToTech('deal-1', { channels: ['email'] }, dispatcher);

      const write = stampedWrite();
      expect(write.sentToTechAt > '2026-04-16T09:00:00.000Z').toBe(true);
      expect(write.sentToTechVia).toEqual(['email']);
      expect(timeline.addEntry).toHaveBeenCalledTimes(1);
      expect(sns.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('markSeenByTech', () => {
    const tech = createMockJwtUser({ id: 'tech-1', email: 'tech@test.com' });

    it('answers seen: false and writes nothing for someone not on the roster', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-2'] }));

      expect(await service.markSeenByTech('deal-1', tech)).toEqual({ seen: false, first: false });

      expect(repo.markAssignmentSeen).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('first open stamps the assignment row, the job and the timeline ("Viewed job in app")', async () => {
      const deal = createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      const result = await service.markSeenByTech('deal-1', tech);

      expect(result.seen).toBe(true);
      expect(result.first).toBe(true);
      expect(repo.markAssignmentSeen).toHaveBeenCalledWith('deal-1', 'tech-1', result.seenAt);
      expect(repo.update).toHaveBeenCalledWith('deal-1', { seenByTechAt: result.seenAt });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: TimelineEventType.SEEN_BY_TECH,
          actorId: 'tech-1',
          details: { techId: 'tech-1', seenAt: result.seenAt },
        }),
      );
    });

    it('a second technician opening a job already seen stamps only their row', async () => {
      const deal = createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'], seenByTechAt: '2026-04-16T09:00:00.000Z' });
      repo.findById.mockResolvedValue(deal);

      const result = await service.markSeenByTech('deal-1', tech);

      expect(result.first).toBe(true);
      expect(repo.markAssignmentSeen).toHaveBeenCalledTimes(1);
      // The job-level flag is sticky: the first open of the whole job stays.
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).toHaveBeenCalledTimes(1);
    });

    it('re-opening is a no-op that reports the original time', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'], seenByTechAt: '2026-04-16T09:00:00.000Z' }));
      repo.markAssignmentSeen.mockResolvedValue('2026-04-16T09:00:00.000Z');

      expect(await service.markSeenByTech('deal-1', tech)).toEqual({
        seen: true,
        seenAt: '2026-04-16T09:00:00.000Z',
        first: false,
      });
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
    });
  });

  describe('recordSentToTechDelivery (internal, from messaging)', () => {
    const report = {
      techId: 'tech-1',
      channel: 'sms' as const,
      status: 'sent' as const,
      sentAt: '2026-04-16T10:00:00.000Z',
      messageId: 'm1',
      conversationId: 'c1',
      at: '2026-04-16T10:00:02.000Z',
    };

    it('stores the outcome on the assignment row', async () => {
      repo.getAssignment.mockResolvedValue({ dealId: 'deal-1', techId: 'tech-1', sentAt: '2026-04-16T10:00:00.000Z' });

      expect(await service.recordSentToTechDelivery('deal-1', report)).toEqual({ recorded: true });

      expect(repo.recordAssignmentDelivery).toHaveBeenCalledWith('deal-1', 'tech-1', 'sms', {
        status: 'sent',
        sentAt: '2026-04-16T10:00:00.000Z',
        at: '2026-04-16T10:00:02.000Z',
        messageId: 'm1',
        conversationId: 'c1',
      });
    });

    it('keeps the skip reason and defaults `at` to now', async () => {
      repo.getAssignment.mockResolvedValue({ dealId: 'deal-1', techId: 'tech-1', sentAt: '2026-04-16T10:00:00.000Z' });

      await service.recordSentToTechDelivery('deal-1', {
        techId: 'tech-1', channel: 'email', status: 'skipped', sentAt: '2026-04-16T10:00:00.000Z', reason: 'no_email',
      });

      const stored = repo.recordAssignmentDelivery.mock.calls[0][3];
      expect(stored).toMatchObject({ status: 'skipped', reason: 'no_email' });
      expect(typeof stored.at).toBe('string');
      expect(stored).not.toHaveProperty('messageId');
    });

    it('ignores a technician who is not on the job and a report about an older click', async () => {
      repo.getAssignment.mockResolvedValue(null);
      expect(await service.recordSentToTechDelivery('deal-1', report)).toEqual({ recorded: false });

      repo.getAssignment.mockResolvedValue({ dealId: 'deal-1', techId: 'tech-1', sentAt: '2026-04-16T11:00:00.000Z' });
      expect(await service.recordSentToTechDelivery('deal-1', report)).toEqual({ recorded: false });

      expect(repo.recordAssignmentDelivery).not.toHaveBeenCalled();
    });
  });
});
