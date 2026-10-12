import { NotFoundException } from '@nestjs/common';
import { JobSuperStatus, TimelineEventType, type Deal } from '@bitcrm/types';
import { ClientConfirmService } from 'src/deals/client-confirm/client-confirm.service';
import { createMockDeal } from '../mocks';

// 2026-04-20 08:00 in New York: the 09:00-12:00 visit is still ahead.
const NOW = new Date('2026-04-20T12:00:00.000Z');

function setup(deal: Deal | null, opts: { recorded?: boolean; areaZone?: string } = {}) {
  const repository = {
    findById: jest.fn().mockResolvedValue(deal),
    recordClientConfirmation: jest.fn().mockResolvedValue(opts.recorded ?? true),
  };
  const cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const timeline = { addEntry: jest.fn().mockResolvedValue(undefined) };
  const serviceAreas = { findById: jest.fn().mockResolvedValue(opts.areaZone ? { timezone: opts.areaZone } : null) };
  const jobTypes = { findById: jest.fn().mockResolvedValue({ id: 'jobtype-1', name: 'Lockout' }) };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ClientConfirmService(
    repository as any,
    cache as any,
    timeline as any,
    serviceAreas as any,
    jobTypes as any,
    sns as any,
  );
  return { service, repository, cache, timeline, sns, serviceAreas };
}

describe('ClientConfirmService (B12)', () => {
  describe('view', () => {
    it('hands billing what the confirm page shows: the visit, the place, the company and the state', async () => {
      const deal = createMockDeal({ businessProfileId: 'bp-2', jobTimezone: 'America/Chicago' });
      const { service } = setup(deal);

      const view = await service.view('deal-1', NOW);

      expect(view).toEqual({
        dealId: 'deal-1',
        dealNumber: 'AB12CD',
        state: 'open',
        scheduledDate: '2026-04-20',
        scheduledTimeSlot: '09:00-12:00',
        timezone: 'America/Chicago',
        address: deal.address,
        jobType: 'Lockout',
        businessProfileId: 'bp-2',
      });
    });

    it('reads the visit on the service area’s clock when the job has no zone of its own', async () => {
      // 12:30 New York is 09:30 in Los Angeles: the LA visit (09:00-12:00) is still on.
      const { service } = setup(createMockDeal({ serviceAreaId: 'area-la' }), { areaZone: 'America/Los_Angeles' });
      const view = await service.view('deal-1', new Date('2026-04-20T16:30:00.000Z'));
      expect(view.state).toBe('open');
      expect(view.timezone).toBe('America/Los_Angeles');
    });

    it('404s for a job that does not exist', async () => {
      const { service } = setup(null);
      await expect(service.view('nope', NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('records the confirmation, writes "Client Confirmed job" and tells the automations', async () => {
      const { service, repository, cache, timeline, sns } = setup(createMockDeal());

      const result = await service.confirm('deal-1', { via: 'link', ip: '203.0.113.9', userAgent: 'Safari' }, NOW);

      expect(repository.recordClientConfirmation).toHaveBeenCalledWith('deal-1', {
        at: NOW.toISOString(),
        via: 'link',
        by: 'contact-1',
        visit: '2026-04-20 09:00-12:00',
      });
      expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          dealId: 'deal-1',
          contactId: 'contact-1',
          eventType: TimelineEventType.CLIENT_CONFIRMED,
          actorId: 'client',
          actorName: 'Client',
          timestamp: NOW.toISOString(),
          details: { via: 'link', visit: '2026-04-20 09:00-12:00', ip: '203.0.113.9', userAgent: 'Safari' },
        }),
      );
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.client_confirmed', {
        dealId: 'deal-1',
        dealNumber: 'AB12CD',
        contactId: 'contact-1',
        confirmedAt: NOW.toISOString(),
        via: 'link',
        visit: '2026-04-20 09:00-12:00',
      });
      expect(result).toMatchObject({ state: 'confirmed', confirmedAt: NOW.toISOString(), recorded: true });
    });

    it('sets no sub-status — Workiz’s confirmation changes none (the dispatcher or a rule does)', async () => {
      const { service, repository } = setup(createMockDeal({ superStatus: JobSuperStatus.SUBMITTED }));
      await service.confirm('deal-1', { via: 'link' }, NOW);
      const written = repository.recordClientConfirmation.mock.calls[0][1];
      expect(written).not.toHaveProperty('subStatusId');
    });

    it('is idempotent: a second tap writes, logs and publishes nothing', async () => {
      const confirmedAt = '2026-04-19T15:00:00.000Z';
      const { service, repository, timeline, sns } = setup(
        createMockDeal({ clientConfirmedAt: confirmedAt, clientConfirmedFor: '2026-04-20 09:00-12:00' }),
      );

      const result = await service.confirm('deal-1', { via: 'link' }, NOW);

      expect(repository.recordClientConfirmation).not.toHaveBeenCalled();
      expect(timeline.addEntry).not.toHaveBeenCalled();
      expect(sns.publish).not.toHaveBeenCalled();
      expect(result).toMatchObject({ state: 'confirmed', confirmedAt, recorded: false });
    });

    it('loses a race gracefully: when the conditional write finds it already confirmed, nothing else happens', async () => {
      const { service, timeline, sns, repository } = setup(createMockDeal(), { recorded: false });
      repository.findById
        .mockResolvedValueOnce(createMockDeal())
        .mockResolvedValueOnce(
          createMockDeal({ clientConfirmedAt: '2026-04-20T11:59:59.000Z', clientConfirmedFor: '2026-04-20 09:00-12:00' }),
        );

      const result = await service.confirm('deal-1', { via: 'link' }, NOW);

      expect(timeline.addEntry).not.toHaveBeenCalled();
      expect(sns.publish).not.toHaveBeenCalled();
      expect(result).toMatchObject({ state: 'confirmed', confirmedAt: '2026-04-20T11:59:59.000Z', recorded: false });
    });

    it('lets the client confirm the new time after a reschedule', async () => {
      const { service, repository, sns } = setup(
        createMockDeal({
          scheduledDate: '2026-04-20',
          clientConfirmedAt: '2026-04-18T15:00:00.000Z',
          clientConfirmedFor: '2026-04-19 09:00-12:00',
        }),
      );
      const result = await service.confirm('deal-1', { via: 'link' }, NOW);
      expect(repository.recordClientConfirmation).toHaveBeenCalled();
      expect(sns.publish).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('confirmed');
    });

    it('changes nothing on a closed job or after the visit — the page says so politely', async () => {
      for (const deal of [
        createMockDeal({ superStatus: JobSuperStatus.CANCELED }),
        createMockDeal({ superStatus: JobSuperStatus.DONE }),
      ]) {
        const { service, repository, timeline, sns } = setup(deal);
        const result = await service.confirm('deal-1', { via: 'link' }, NOW);
        expect(result.state).toBe('closed');
        expect(repository.recordClientConfirmation).not.toHaveBeenCalled();
        expect(timeline.addEntry).not.toHaveBeenCalled();
        expect(sns.publish).not.toHaveBeenCalled();
      }

      const { service, repository } = setup(createMockDeal());
      const late = await service.confirm('deal-1', { via: 'link' }, new Date('2026-04-21T12:00:00.000Z'));
      expect(late.state).toBe('expired');
      expect(repository.recordClientConfirmation).not.toHaveBeenCalled();
    });

    it('keeps the confirmation when the history or the event fails (they are best effort)', async () => {
      const { service, timeline, sns } = setup(createMockDeal());
      timeline.addEntry.mockRejectedValue(new Error('throttled'));
      sns.publish.mockRejectedValue(new Error('sns down'));
      const result = await service.confirm('deal-1', { via: 'link' }, NOW);
      expect(result).toMatchObject({ state: 'confirmed', recorded: true });
    });
  });
});
