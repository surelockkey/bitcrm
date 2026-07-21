import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsCacheService } from 'src/deals/deals-cache.service';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealProductsRepository } from 'src/products/deal-products.repository';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import {
  createMockDeal,
  createMockAddress,
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
 * A deal is only plottable on the dispatch map if its address carries
 * coordinates. Nothing in the platform geocodes, and `update()` used to
 * overwrite `address` wholesale — so any coordinates a deal had were destroyed
 * the first time anyone saved an edit. These are the guards for both halves.
 */
describe('DealsService — address geocoding', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let cache: ReturnType<typeof createMockDealsCacheService>;
  let geocoding: ReturnType<typeof createMockGeocodingService>;

  const caller = createMockJwtUser();

  beforeEach(async () => {
    repo = createMockDealsRepository();
    cache = createMockDealsCacheService();
    geocoding = createMockGeocodingService();

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: cache },
        { provide: TimelineRepository, useValue: createMockTimelineRepository() },
        {
          provide: DealProductsRepository,
          useValue: createMockDealProductsRepository(),
        },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: createMockInternalHttpService() },
        { provide: GeocodingService, useValue: geocoding },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  function existing(address = createMockAddress()) {
    const deal = createMockDeal({ address });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(deal);
    repo.update.mockImplementation(async (_id: string, updates: any) => ({
      ...deal,
      ...updates,
    }));
    return deal;
  }

  const createDto = {
    contactId: 'contact-1',
    clientType: 'residential',
    serviceArea: 'Atlanta Metro',
    jobType: 'lockout',
    address: { street: '5 Oak Ave', city: 'Atlanta', state: 'GA', zip: '30303' },
  } as any;

  describe('create', () => {
    it('geocodes an address that arrives without coordinates', async () => {
      repo.getNextDealNumber.mockResolvedValue(1);
      geocoding.geocode.mockResolvedValue({ lat: 34.1, lng: -84.2 });

      const deal = await service.create(createDto, caller);

      expect(geocoding.geocode).toHaveBeenCalledTimes(1);
      expect(deal.address.lat).toBe(34.1);
      expect(deal.address.lng).toBe(-84.2);
    });

    it('trusts coordinates the caller already supplied and does not re-geocode', async () => {
      repo.getNextDealNumber.mockResolvedValue(1);

      const deal = await service.create(
        { ...createDto, address: { ...createDto.address, lat: 1, lng: 2 } },
        caller,
      );

      expect(geocoding.geocode).not.toHaveBeenCalled();
      expect(deal.address.lat).toBe(1);
      expect(deal.address.lng).toBe(2);
    });

    it('still creates the deal when the address cannot be geocoded', async () => {
      repo.getNextDealNumber.mockResolvedValue(1);
      geocoding.geocode.mockResolvedValue(null);

      const deal = await service.create(createDto, caller);

      expect(deal.address.lat).toBeUndefined();
      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    // The bug that would silently empty the dispatch map.
    it('keeps existing coordinates when the address is saved unchanged without them', async () => {
      const deal = existing(
        createMockAddress({ street: '123 Main St', lat: 33.749, lng: -84.388 }),
      );

      await service.update(
        deal.id,
        {
          address: {
            street: '123 Main St',
            city: 'Atlanta',
            state: 'GA',
            zip: '30301',
          },
        } as any,
        caller,
      );

      const written = repo.update.mock.calls[0][1];
      expect(written.address.lat).toBe(33.749);
      expect(written.address.lng).toBe(-84.388);
      expect(geocoding.geocode).not.toHaveBeenCalled();
    });

    it('re-geocodes when the address actually changes', async () => {
      const deal = existing(
        createMockAddress({ street: '123 Main St', lat: 33.749, lng: -84.388 }),
      );
      geocoding.geocode.mockResolvedValue({ lat: 40, lng: -70 });

      await service.update(
        deal.id,
        {
          address: {
            street: '999 Different Rd',
            city: 'Atlanta',
            state: 'GA',
            zip: '30301',
          },
        } as any,
        caller,
      );

      expect(geocoding.geocode).toHaveBeenCalledTimes(1);
      const written = repo.update.mock.calls[0][1];
      expect(written.address.lat).toBe(40);
      expect(written.address.lng).toBe(-70);
    });

    it('honours coordinates explicitly supplied by the caller', async () => {
      const deal = existing();

      await service.update(
        deal.id,
        {
          address: {
            street: '77 New St',
            city: 'Atlanta',
            state: 'GA',
            zip: '30301',
            lat: 11,
            lng: 22,
          },
        } as any,
        caller,
      );

      expect(geocoding.geocode).not.toHaveBeenCalled();
      const written = repo.update.mock.calls[0][1];
      expect(written.address.lat).toBe(11);
      expect(written.address.lng).toBe(22);
    });

    it('leaves the address alone when the update does not touch it', async () => {
      const deal = existing();

      await service.update(deal.id, { notes: 'just a note' } as any, caller);

      expect(geocoding.geocode).not.toHaveBeenCalled();
      expect(repo.update.mock.calls[0][1].address).toBeUndefined();
    });
  });
});
