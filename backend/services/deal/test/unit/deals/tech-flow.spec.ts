import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DataScope, JobSuperStatus, TimelineEventType } from '@bitcrm/types';
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
 * The technician flow the old CRM logs as "Confirmed job receipt" and
 * "Arrived at location": who may say it, what it writes, and the fact that
 * saying it twice changes nothing.
 */
describe('DealsService — technician flow', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let jobStatuses: { findById: jest.Mock; list: jest.Mock };

  /** The technician on the job. */
  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });
  /** A dispatcher — off the roster, but with the whole board in scope. */
  const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

  const assigned = (over = {}) =>
    createMockDeal({
      assignedTechIds: ['tech-1'],
      superStatus: JobSuperStatus.IN_PROGRESS,
      ...over,
    });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    timeline = createMockTimelineRepository();
    sns = createMockSnsPublisherService();
    jobStatuses = { findById: jest.fn(), list: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: createMockDealsCacheService() },
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
        { provide: JobStatusesService, useValue: jobStatuses },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const entryOf = (type: TimelineEventType) =>
    timeline.addEntry.mock.calls.map(([e]: [any]) => e).find((e: any) => e.eventType === type);

  /* ------------------------------------------------------------- confirm */

  describe('confirmReceipt', () => {
    it('stamps the technician’s own assignment row, mirrors it onto the job, and logs it', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue({ ...deal, techConfirmedAt: 'now' });

      await service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY);

      expect(repo.confirmAssignment).toHaveBeenCalledWith('deal-1', 'tech-1', expect.any(String));
      const [, update] = repo.update.mock.calls[0];
      expect(update.techConfirmedAt).toEqual(expect.any(String));
      expect(update.techConfirmedBy).toBe('tech-1');
      expect(entryOf(TimelineEventType.TECH_CONFIRMED)).toMatchObject({
        actorId: 'tech-1',
        details: { techId: 'tech-1' },
      });
    });

    it('refuses a technician who is not on this job', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['someone-else'] }));

      await expect(
        service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.confirmAssignment).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets dispatch confirm on a technician’s behalf, and records who actually did', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.confirmReceipt('deal-1', dispatcher, DataScope.ALL);

      // No row of their own to stamp — dispatch is not on the roster.
      expect(repo.confirmAssignment).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalled();
      expect(entryOf(TimelineEventType.TECH_CONFIRMED).actorId).toBe('dispatcher-1');
    });

    it('is a no-op when dispatch taps Confirm again — they have no row of their own', async () => {
      // The first tap: nothing confirmed yet, dispatch is off the roster.
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue({ ...deal, techConfirmedAt: 'now', techConfirmedBy: 'dispatcher-1' });

      await service.confirmReceipt('deal-1', dispatcher, DataScope.ALL);
      expect(timeline.addEntry).toHaveBeenCalledTimes(1);

      // The second tap — a retried request, or a thumb that hit it twice. The
      // job already carries the mirror, and `getAssignment` will never answer
      // for a caller who is not on the roster.
      repo.findById.mockResolvedValue({
        ...deal,
        techConfirmedAt: '2026-09-16T09:00:00.000Z',
        techConfirmedBy: 'dispatcher-1',
      });

      await service.confirmReceipt('deal-1', dispatcher, DataScope.ALL);

      expect(timeline.addEntry).toHaveBeenCalledTimes(1);
      expect(
        sns.publish.mock.calls.filter(([, type]: [string, string]) => type === 'deal.tech_confirmed'),
      ).toHaveLength(1);
      expect(repo.update).toHaveBeenCalledTimes(1);
    });

    it('writes one entry when two taps from the same technician race the read', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);
      // Both taps read an unconfirmed row; the row write is what decides — the
      // loser is handed the stamp that was already there.
      repo.getAssignment.mockResolvedValue({ dealId: 'deal-1', techId: 'tech-1' });
      repo.confirmAssignment.mockResolvedValue('2026-09-16T09:00:00.000Z');

      await service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY);

      expect(repo.confirmAssignment).toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
      expect(sns.publish).not.toHaveBeenCalled();
    });

    it('is a no-op the second time — the first stamp is the one that counts', async () => {
      repo.findById.mockResolvedValue(assigned());
      repo.getAssignment.mockResolvedValue({
        dealId: 'deal-1',
        techId: 'tech-1',
        techConfirmedAt: '2026-09-16T09:00:00.000Z',
      });

      await service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY);

      expect(repo.confirmAssignment).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('leaves the deal-level mirror alone when another technician already confirmed', async () => {
      const deal = assigned({
        assignedTechIds: ['tech-1', 'tech-2'],
        techConfirmedAt: '2026-09-16T08:00:00.000Z',
        techConfirmedBy: 'tech-2',
      });
      repo.findById.mockResolvedValue(deal);

      await service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY);

      // This technician's own row is stamped; the job keeps the first name.
      expect(repo.confirmAssignment).toHaveBeenCalledWith('deal-1', 'tech-1', expect.any(String));
      expect(repo.update).not.toHaveBeenCalled();
      expect(entryOf(TimelineEventType.TECH_CONFIRMED)).toBeDefined();
    });

    it('refuses a closed job', async () => {
      repo.findById.mockResolvedValue(assigned({ superStatus: JobSuperStatus.CANCELED }));

      await expect(
        service.confirmReceipt('deal-1', tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /* ------------------------------------------------------------- arrived */

  describe('markArrived', () => {
    it('stamps the arrival with the phone’s fix and logs it', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.markArrived(
        'deal-1',
        { lat: 41.76, lng: -72.67, accuracy: 12 },
        tech,
        DataScope.ASSIGNED_ONLY,
      );

      const [, update] = repo.update.mock.calls[0];
      expect(update.arrivedAt).toEqual(expect.any(String));
      expect(update.arrivedBy).toBe('tech-1');
      expect(update.arrivedLocation).toEqual({ lat: 41.76, lng: -72.67, accuracy: 12 });
      expect(entryOf(TimelineEventType.TECH_ARRIVED)).toMatchObject({ details: { techId: 'tech-1' } });
    });

    it('records the arrival without coordinates when the phone offered none', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY);

      const [, update] = repo.update.mock.calls[0];
      expect(update.arrivedAt).toEqual(expect.any(String));
      expect(update).not.toHaveProperty('arrivedLocation');
    });

    it('applies the catalog’s own arrival sub-status when the workspace has one', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);
      jobStatuses.list.mockResolvedValue([
        { id: 's-other', name: 'Job Issues', group: JobSuperStatus.IN_PROGRESS, active: true },
        { id: 's-arrived', name: 'On Site', group: JobSuperStatus.IN_PROGRESS, active: true },
      ]);

      await service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY);

      const [, update] = repo.update.mock.calls[0];
      expect(update.subStatusId).toBe('s-arrived');
      expect(update.statusChangedAt).toEqual(expect.any(String));
    });

    it('leaves the sub-status alone when the catalog has no arrival one', async () => {
      const deal = assigned();
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);
      jobStatuses.list.mockResolvedValue([
        { id: 's-other', name: 'Job Issues', group: JobSuperStatus.IN_PROGRESS, active: true },
      ]);

      await service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY);

      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('subStatusId');
    });

    it('does not reach for a sub-status on a job that is not In Progress', async () => {
      const deal = assigned({ superStatus: JobSuperStatus.SUBMITTED });
      repo.findById.mockResolvedValue(deal);
      repo.update.mockResolvedValue(deal);

      await service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY);

      expect(jobStatuses.list).not.toHaveBeenCalled();
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('subStatusId');
    });

    it('rejects a chosen sub-status that belongs to a different super-status', async () => {
      repo.findById.mockResolvedValue(assigned());
      jobStatuses.findById.mockResolvedValue({
        id: 's-billing',
        name: 'BILLING',
        group: JobSuperStatus.DONE_PENDING_APPROVAL,
      });

      await expect(
        service.markArrived('deal-1', { subStatusId: 's-billing' }, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses a technician who is not on this job', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['someone-else'] }));

      await expect(
        service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is a no-op once the job has an arrival', async () => {
      repo.findById.mockResolvedValue(assigned({ arrivedAt: '2026-09-16T13:00:00.000Z' }));

      await service.markArrived('deal-1', { lat: 1, lng: 2 }, tech, DataScope.ASSIGNED_ONLY);

      expect(repo.update).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('refuses a closed job', async () => {
      repo.findById.mockResolvedValue(assigned({ superStatus: JobSuperStatus.DONE }));

      await expect(
        service.markArrived('deal-1', {}, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
