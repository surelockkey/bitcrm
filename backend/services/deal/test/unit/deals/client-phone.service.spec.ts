/**
 * `PUT /deals/:id/client-phone` — the job side of a first number changed on
 * the job page. The client profile itself is crm's, written by the page with
 * the rest of the client's edits AFTER this call: the old number is read from
 * crm here, before it changes, and pinned onto the jobs that keep it.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealStatus, JobSuperStatus, type Deal } from '@bitcrm/types';
import { ClientPhoneService } from 'src/deals/client-phone/client-phone.service';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockInternalHttpService,
  createMockJwtUser,
  createMockSnsPublisherService,
} from '../mocks';

const OLD = '+14045550100';
const NEW = '+14045550199';

function setup(jobs: Deal[] = []) {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const http = createMockInternalHttpService();
  const sns = createMockSnsPublisherService();
  const edited = createMockDeal({ id: 'deal-1', contactId: 'contact-1' });
  repo.findById.mockResolvedValue(edited);
  repo.update.mockImplementation(async (id: string, attrs: Partial<Deal>) => ({
    ...(id === 'deal-1' ? edited : jobs.find((j) => j.id === id)),
    ...attrs,
  }));
  repo.findByContact.mockResolvedValue({ items: [edited, ...jobs], nextCursor: undefined });
  http.getContact.mockResolvedValue({ id: 'contact-1', phones: [OLD, '+14045550111'] });
  const service = new ClientPhoneService(repo as any, cache as any, http as any, sns as any);
  return { service, repo, cache, http, sns };
}

const user = createMockJwtUser({ id: 'u-1' });

describe('ClientPhoneService.change', () => {
  it('This job only: the job gets the number as its own, nothing else is read or written', async () => {
    const { service, repo, cache, sns } = setup();

    const out = await service.change('deal-1', { phone: '(404) 555-0199', scope: 'job' }, user);

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('deal-1', { clientPhone: NEW });
    expect(repo.findByContact).not.toHaveBeenCalled();
    expect(cache.invalidate).toHaveBeenCalledWith('deal-1');
    expect(sns.publish).toHaveBeenCalledWith('deal-events', 'deal.updated', { dealId: 'deal-1', updatedBy: 'u-1' });
    expect(out).toEqual({ deal: expect.objectContaining({ id: 'deal-1', clientPhone: NEW }), otherJobsChanged: 0 });
  });

  it('This job and the profile: the other jobs that showed the old number are pinned to it', async () => {
    const shown = createMockDeal({ id: 'j-open' });
    const own = createMockDeal({ id: 'j-own', clientPhone: '+12035550123' });
    const { service, repo, cache } = setup([shown, own]);

    const out = await service.change('deal-1', { phone: NEW, scope: 'client' }, user);

    expect(repo.findByContact).toHaveBeenCalledWith('contact-1', 100, undefined);
    expect(repo.update).toHaveBeenCalledWith('j-open', { clientPhone: OLD });
    expect(repo.update).not.toHaveBeenCalledWith('j-own', expect.anything());
    // The edited job follows the profile: no override to drop, so no write.
    expect(repo.update).not.toHaveBeenCalledWith('deal-1', expect.anything());
    expect(cache.invalidate).toHaveBeenCalledWith('j-open');
    expect(out.otherJobsChanged).toBe(1);
  });

  it('open jobs: open unpaid jobs take the new number, closed ones keep the old', async () => {
    const open = createMockDeal({ id: 'j-open', clientPhone: OLD });
    const closed = createMockDeal({ id: 'j-done', superStatus: JobSuperStatus.DONE });
    const { service, repo } = setup([open, closed]);

    const out = await service.change('deal-1', { phone: NEW, scope: 'open_jobs' }, user);

    expect(repo.update).toHaveBeenCalledWith('j-open', { clientPhone: null });
    expect(repo.update).toHaveBeenCalledWith('j-done', { clientPhone: OLD });
    expect(out.otherJobsChanged).toBe(2);
  });

  it('walks every page of the client’s jobs', async () => {
    const { service, repo } = setup();
    repo.findByContact
      .mockResolvedValueOnce({ items: [createMockDeal({ id: 'a' })], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [createMockDeal({ id: 'b' })], nextCursor: undefined });

    const out = await service.change('deal-1', { phone: NEW, scope: 'client' }, user);

    expect(repo.findByContact).toHaveBeenNthCalledWith(2, 'contact-1', 100, 'c1');
    expect(out.otherJobsChanged).toBe(2);
  });

  it('a job deleted under the walk is skipped, not a failure', async () => {
    const { service, repo } = setup([createMockDeal({ id: 'gone' })]);
    repo.update.mockImplementation(async (id: string, attrs: Partial<Deal>) => {
      if (id === 'gone') throw Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' });
      return createMockDeal({ id, ...attrs });
    });

    await expect(service.change('deal-1', { phone: NEW, scope: 'client' }, user)).resolves.toEqual(
      expect.objectContaining({ otherJobsChanged: 0 }),
    );
  });

  it('refuses a number that is not one', async () => {
    const { service } = setup();
    await expect(service.change('deal-1', { phone: '12', scope: 'job' }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a missing or deleted job', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.change('nope', { phone: NEW, scope: 'job' }, user)).rejects.toBeInstanceOf(NotFoundException);
    repo.findById.mockResolvedValueOnce(createMockDeal({ status: DealStatus.DELETED }));
    await expect(service.change('deal-1', { phone: NEW, scope: 'job' }, user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
