/**
 * The job's address keeps its country. DynamoDB writes `address` as one whole
 * map, so an edit from a form that does not know the field (today's job page)
 * would turn every imported Canadian address into a US one — the same trap
 * the coordinates fell into. An address that names no country keeps the one
 * it had; naming one (`US` included) sets it.
 */
import { ClientType } from '@bitcrm/types';
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
  createMockTimelineRepository,
} from '../mocks';

const toronto = { street: '1 Front St W', city: 'Toronto', state: 'ON', zip: 'M5J 2X5' };

function makeService() {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const stub = {} as any;
  const service = new DealsService(
    repo as any,
    cache as any,
    createMockTimelineRepository() as any,
    stub,
    createMockInternalHttpService() as any,
    createMockGeocodingService() as any,
    { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() } as any,
    { findById: jest.fn().mockResolvedValue(createMockJobType()) } as any,
    stub,
    stub,
    { list: jest.fn().mockResolvedValue([]) } as any,
    stub,
    createMockCustomFieldsService() as any,
    stub,
  );
  return { service, repo, cache };
}

describe('DealsService — address country', () => {
  const caller = createMockJwtUser({ id: 'dispatcher-1' });

  it('create stores the country with the address', async () => {
    const { service, repo } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');

    const deal = await service.create(
      {
        contactId: 'contact-1',
        clientType: ClientType.RESIDENTIAL,
        address: { ...toronto, country: 'CA' },
        jobTypeId: 'jobtype-1',
      } as any,
      caller,
    );

    expect(deal.address.country).toBe('CA');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ address: expect.objectContaining({ country: 'CA' }) }),
    );
  });

  it('an address edit that names no country keeps the stored one', async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({ address: { ...toronto, country: 'CA', lat: 43.64, lng: -79.38 } });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockImplementation(async (_id: string, attrs: object) => ({ ...existing, ...attrs }));

    await service.update('deal-1', { address: { ...toronto, unit: 'Suite 4' } } as any, caller);

    const [, updates] = repo.update.mock.calls.at(-1)!;
    expect(updates.address.country).toBe('CA');
  });

  it('an address edit that names a country sets it — US included', async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal({ address: { ...toronto, country: 'CA' } });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockImplementation(async (_id: string, attrs: object) => ({ ...existing, ...attrs }));

    await service.update(
      'deal-1',
      { address: { street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301', country: 'US' } } as any,
      caller,
    );

    const [, updates] = repo.update.mock.calls.at(-1)!;
    expect(updates.address.country).toBe('US');
  });

  it('an address that never had a country gets none invented', async () => {
    const { service, repo, cache } = makeService();
    const existing = createMockDeal();
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockImplementation(async (_id: string, attrs: object) => ({ ...existing, ...attrs }));

    await service.update('deal-1', { address: { street: '9 Peach St', city: 'Atlanta', state: 'GA', zip: '30303' } } as any, caller);

    const [, updates] = repo.update.mock.calls.at(-1)!;
    expect(updates.address).not.toHaveProperty('country');
  });
});
