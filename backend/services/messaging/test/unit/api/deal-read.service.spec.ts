import { DealReadService } from '../../../src/api/access/deal-read.service';
import { createMockDeal, mockFetch } from './api-mocks';

describe('DealReadService', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, DEAL_SERVICE_URL: 'http://deal:4003', INTERNAL_SERVICE_SECRET: 's3cret' };
  });
  afterEach(() => {
    process.env = env;
  });

  it('reads one deal from the internal route with the secret header and caches it', async () => {
    const fetchImpl = mockFetch({ '/api/deals/internal/d1': { body: { data: createMockDeal() } } });
    const svc = new DealReadService(fetchImpl);

    const deal = await svc.find('d1');
    expect(deal).toMatchObject({ id: 'd1', contactId: 'ct1', assignedTechIds: ['tech-1'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://deal:4003/api/deals/internal/d1', {
      headers: { 'x-internal-secret': 's3cret' },
    });

    await svc.find('d1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('answers null for a 404 and caches that answer too', async () => {
    const fetchImpl = mockFetch({});
    const svc = new DealReadService(fetchImpl);
    expect(await svc.find('missing')).toBeNull();
    expect(await svc.find('missing')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('answers null on a 5xx or a network failure without caching', async () => {
    const svc = new DealReadService(mockFetch({ '/api/deals/internal/d1': { status: 503 } }));
    expect(await svc.find('d1')).toBeNull();

    const failing = new DealReadService(mockFetch({ '/api/deals/internal/d1': new Error('ECONNREFUSED') }));
    expect(await failing.find('d1')).toBeNull();
  });

  it('defaults assignedTechIds to an empty roster', async () => {
    const svc = new DealReadService(
      mockFetch({ '/api/deals/internal/d1': { body: { data: { id: 'd1', contactId: 'ct1' } } } }),
    );
    expect((await svc.find('d1'))?.assignedTechIds).toEqual([]);
  });

  it('lists a technician’s deals and distinguishes "none" from "unreachable"', async () => {
    const ok = new DealReadService(
      mockFetch({ '/api/deals/internal/by-tech/tech-1': { body: { data: [createMockDeal()] } } }),
    );
    expect(await ok.listByTech('tech-1')).toHaveLength(1);

    const empty = new DealReadService(
      mockFetch({ '/api/deals/internal/by-tech/tech-1': { body: { data: [] } } }),
    );
    expect(await empty.listByTech('tech-1')).toEqual([]);

    const down = new DealReadService(mockFetch({ '/api/deals/internal/by-tech/tech-1': { status: 502 } }));
    expect(await down.listByTech('tech-1')).toBeNull();
  });

  it('forget() drops a cached deal', async () => {
    const fetchImpl = mockFetch({ '/api/deals/internal/d1': { body: { data: createMockDeal() } } });
    const svc = new DealReadService(fetchImpl);
    await svc.find('d1');
    svc.forget('d1');
    await svc.find('d1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
