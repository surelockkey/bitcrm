/**
 * `GET /deals/:id` names its client (QA 2026-10-16, #1).
 *
 * The job row stores only `contactId`; the client's name lived in the jobs
 * list's `included.clients` alone. The technician's phone named a job's
 * client only while the job sat in a list it had cached — so a job that left
 * the open lists (marked Done) or was opened from a push or a link showed no
 * client at all. The single-job read now side-loads the name the list does:
 * one internal call to crm's names route, names only (crm masks numbers per
 * caller and this read cannot), never written into the cached job, and never
 * able to cost the job itself.
 */
import { DealsController } from 'src/deals/deals.controller';
import { DealsService } from 'src/deals/deals.service';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockInternalHttpService,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

function setup() {
  const repository = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const internalHttp = createMockInternalHttpService();
  const stub = {} as any;
  const service = new DealsService(
    repository as any,
    cache as any,
    stub, stub,
    internalHttp as any,
    stub, stub, stub, stub, stub, stub, stub, stub,
    createMockTechnicianEligibilityRepository() as any,
  );
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, repository, cache, internalHttp };
}

describe('DealsService.findByIdWithClientName', () => {
  it("carries the client's name, asked of crm for this job's contact only", async () => {
    const { service, cache, internalHttp } = setup();
    cache.get.mockResolvedValue(createMockDeal({ id: 'd1', contactId: 'c-9' }));
    internalHttp.getContactNames.mockResolvedValue([{ id: 'c-9', firstName: 'QA-TEST', lastName: 'Mobile 0858' }]);

    const deal = await service.findByIdWithClientName('d1');

    expect(internalHttp.getContactNames).toHaveBeenCalledWith(['c-9']);
    expect(deal.id).toBe('d1');
    expect(deal.contactName).toEqual({ firstName: 'QA-TEST', lastName: 'Mobile 0858' });
  });

  it('carries the name and nothing else crm sends with it', async () => {
    const { service, cache, internalHttp } = setup();
    cache.get.mockResolvedValue(createMockDeal({ contactId: 'c-1' }));
    internalHttp.getContactNames.mockResolvedValue([
      { id: 'c-1', firstName: 'Bo', lastName: 'Client', phones: ['+12035550177'] } as any,
    ]);

    const deal = await service.findByIdWithClientName('deal-1');

    expect(deal.contactName).toEqual({ firstName: 'Bo', lastName: 'Client' });
  });

  it('never writes the name into the cached job', async () => {
    const { service, cache, repository, internalHttp } = setup();
    const stored = createMockDeal({ contactId: 'c-1' });
    cache.get.mockResolvedValue(null);
    repository.findById.mockResolvedValue(stored);
    internalHttp.getContactNames.mockResolvedValue([{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }]);

    await service.findByIdWithClientName('deal-1');

    expect(cache.set).toHaveBeenCalledWith(stored);
    expect(stored).not.toHaveProperty('contactName');
  });

  it('keeps the job’s own name override beside the client’s name', async () => {
    const { service, cache, internalHttp } = setup();
    cache.get.mockResolvedValue(
      createMockDeal({ contactId: 'c-1', clientName: { firstName: 'Ada', lastName: 'Byron' } }),
    );
    internalHttp.getContactNames.mockResolvedValue([{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }]);

    const deal = await service.findByIdWithClientName('deal-1');

    expect(deal.clientName).toEqual({ firstName: 'Ada', lastName: 'Byron' });
    expect(deal.contactName).toEqual({ firstName: 'Bo', lastName: 'Client' });
  });

  it('still answers with the job when crm is down', async () => {
    const { service, cache, internalHttp } = setup();
    cache.get.mockResolvedValue(createMockDeal({ id: 'd1', contactId: 'c-1' }));
    internalHttp.getContactNames.mockRejectedValue(new Error('ECONNREFUSED'));

    const deal = await service.findByIdWithClientName('d1');

    expect(deal.id).toBe('d1');
    expect(deal).not.toHaveProperty('contactName');
  });

  it('leaves the name out when crm knows no such client', async () => {
    const { service, cache, internalHttp } = setup();
    cache.get.mockResolvedValue(createMockDeal({ contactId: 'c-gone' }));
    internalHttp.getContactNames.mockResolvedValue([]);

    const deal = await service.findByIdWithClientName('deal-1');

    expect(deal).not.toHaveProperty('contactName');
  });
});

describe('DealsController.findById', () => {
  it('answers GET /deals/:id with the job and its client’s name', async () => {
    const named = { ...createMockDeal(), contactName: { firstName: 'Bo', lastName: 'Client' } };
    const service = { findByIdWithClientName: jest.fn().mockResolvedValue(named) };
    const controller = new DealsController(service as any);

    const result = await controller.findById('deal-1');

    expect(service.findByIdWithClientName).toHaveBeenCalledWith('deal-1');
    expect(result).toEqual({ success: true, data: named });
  });
});
