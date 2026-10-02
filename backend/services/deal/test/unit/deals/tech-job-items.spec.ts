import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GeocodingService, SnsPublisherService } from '@bitcrm/shared';
import { DataScope, TimelineEventType } from '@bitcrm/types';
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
  createMockDealProduct,
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
 * The owner's ask: "the technician adds items from his container and that
 * forms the price; the dispatcher can add prices too". A technician has no
 * `financials.view`, so inventory hands his phone the price book WITHOUT
 * `costCompany` — the line's costs therefore come from the server's own read
 * of the price book, never from the request.
 */
describe('DealsService — a technician adds, edits and removes items on his own job', () => {
  let service: DealsService;
  let repo: ReturnType<typeof createMockDealsRepository>;
  let products: ReturnType<typeof createMockDealProductsRepository>;
  let http: ReturnType<typeof createMockInternalHttpService>;
  let timeline: ReturnType<typeof createMockTimelineRepository>;

  /** The technician on the job. */
  const tech = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });

  /** What inventory's internal route answers for the part: costs included. */
  const catalog = {
    id: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    type: 'product',
    costCompany: 15,
    costTech: 20,
    priceClient: 45,
  };

  /** What the phone sends: no costs — it never saw `costCompany`. */
  const phoneLine = {
    fulfillment: 'sourced' as const,
    sourceTechId: 'tech-1',
    productId: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    quantity: 1,
    priceClient: 45,
  };

  const onHisJob = (over = {}) => createMockDeal({ assignedTechIds: ['tech-1'], ...over });

  beforeEach(async () => {
    repo = createMockDealsRepository();
    products = createMockDealProductsRepository();
    http = createMockInternalHttpService();
    timeline = createMockTimelineRepository();
    http.getProduct.mockResolvedValue(catalog);

    const module = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DealsRepository, useValue: repo },
        { provide: DealsCacheService, useValue: createMockDealsCacheService() },
        { provide: TimelineRepository, useValue: timeline },
        { provide: DealProductsRepository, useValue: products },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
        { provide: InternalHttpService, useValue: http },
        { provide: GeocodingService, useValue: createMockGeocodingService() },
        { provide: ServiceAreasService, useValue: { resolvePoint: jest.fn().mockResolvedValue(null) } },
        { provide: JobTypesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobType()) } },
        { provide: JobSourcesService, useValue: { findById: jest.fn().mockResolvedValue(createMockJobSource()) } },
        { provide: ExternalCompaniesService, useValue: { findById: jest.fn() } },
        { provide: JobTagsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: JobStatusesService, useValue: { findById: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        { provide: TechnicianEligibilityRepository, useValue: createMockTechnicianEligibilityRepository() },
        { provide: CustomFieldsService, useValue: createMockCustomFieldsService() },
      ],
    }).compile();

    service = module.get(DealsService);
  });

  const written = () => products.addProduct.mock.calls[0][1];

  /* ------------------------------------------------- costs from the catalog */

  describe('the line costs come from the price book', () => {
    it('adds a line the phone sent without costs, filling them in from the catalog', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', phoneLine as any, tech);

      expect(http.getProduct).toHaveBeenCalledWith('product-1');
      expect(written()).toMatchObject({ costCompany: 15, costForTech: 20, priceClient: 45 });
    });

    it('ignores costs a client sends — the price book is the only source', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', { ...phoneLine, costCompany: 1, costForTech: 2 } as any, tech);

      expect(written()).toMatchObject({ costCompany: 15, costForTech: 20 });
    });

    it('writes zero for a cost the catalog does not carry', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, costCompany: undefined, costTech: undefined });

      await service.addProduct('deal-1', phoneLine as any, tech);

      expect(written()).toMatchObject({ costCompany: 0, costForTech: 0 });
    });

    it('edits a line without costs: the edited line carries the catalog costs', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, quantity: 2 } as any, tech);

      expect(written()).toMatchObject({ quantity: 2, costCompany: 15, costForTech: 20 });
    });

    it('logs the cost change the edit actually wrote, not what the request said', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', phoneLine as any, tech);

      const entry = timeline.addEntry.mock.calls
        .map(([e]: [any]) => e)
        .find((e: any) => e.eventType === TimelineEventType.PRODUCT_UPDATED);
      expect(entry.details.changes).toEqual({
        costCompany: { from: 10, to: 15 },
        costForTech: { from: 12, to: 20 },
      });
    });
  });

  /* ------------------------------------------------------- only his jobs */

  describe("a technician (deals scope assigned_only) touches only the jobs he is on", () => {
    const someoneElses = () => createMockDeal({ assignedTechIds: ['tech-2'] });
    const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });

    it('adds an item to his own job', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', phoneLine as any, tech, DataScope.ASSIGNED_ONLY);

      expect(products.addProduct).toHaveBeenCalled();
    });

    it("refuses to add an item to someone else's job — 403, no stock moved, nothing written", async () => {
      repo.findById.mockResolvedValue(someoneElses());

      await expect(
        service.addProduct('deal-1', { ...phoneLine, sourceTechId: 'tech-2' } as any, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it("refuses to edit an item on someone else's job", async () => {
      repo.findById.mockResolvedValue(someoneElses());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-2' }));

      await expect(
        service.replaceProduct('deal-1', 'line-1', { ...phoneLine, sourceTechId: 'tech-2' } as any, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it("refuses to remove an item from someone else's job", async () => {
      repo.findById.mockResolvedValue(someoneElses());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-2' }));

      await expect(
        service.removeProduct('deal-1', 'line-1', tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(products.removeProduct).not.toHaveBeenCalled();
    });

    it("refuses to mark an item ordered on someone else's job", async () => {
      repo.findById.mockResolvedValue(someoneElses());
      products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order' }));

      await expect(
        service.markProductOrdered('deal-1', 'line-1', true, tech, DataScope.ASSIGNED_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(products.setOrderedAt).not.toHaveBeenCalled();
    });

    it('removes and marks ordered on his own job', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order' }));

      await service.markProductOrdered('deal-1', 'line-1', true, tech, DataScope.ASSIGNED_ONLY);
      await service.removeProduct('deal-1', 'line-1', tech, DataScope.ASSIGNED_ONLY);

      expect(products.setOrderedAt).toHaveBeenCalled();
      expect(products.removeProduct).toHaveBeenCalledWith('deal-1', 'line-1');
    });

    it('lets a dispatcher, whose scope is wider, work on any job of the board', async () => {
      repo.findById.mockResolvedValue(someoneElses());

      await service.addProduct('deal-1', { ...phoneLine, sourceTechId: 'tech-2' } as any, dispatcher, DataScope.DEPARTMENT);

      expect(products.addProduct).toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------ the ±15% band */

  describe('the client price stays within ±15% of the price book (as the web dialog holds it)', () => {
    // Catalog $45.00 → $38.25 … $51.75.
    const BAND_45 = 'Price must be between $38.25 and $51.75 (±15% of the price book)';

    const refusal = async (promise: Promise<unknown>) => {
      const err = (await promise.then(() => undefined, (e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(BadRequestException);
      return err.message as string;
    };

    it('refuses an added line priced above the band — 400, nothing deducted or written', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      expect(await refusal(service.addProduct('deal-1', { ...phoneLine, priceClient: 52 } as any, tech))).toBe(BAND_45);
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('refuses an added line priced below the band', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      expect(await refusal(service.addProduct('deal-1', { ...phoneLine, priceClient: 38 } as any, tech))).toBe(BAND_45);
    });

    it('accepts both edges of the band', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', { ...phoneLine, priceClient: 38.25 } as any, tech);
      await service.addProduct('deal-1', { ...phoneLine, priceClient: 51.75 } as any, tech);

      expect(products.addProduct).toHaveBeenCalledTimes(2);
    });

    it('holds for service and to-order lines too', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, type: 'service' });

      await expect(
        service.addProduct('deal-1', { ...phoneLine, fulfillment: 'service', priceClient: 90 } as any, tech),
      ).rejects.toThrow(BadRequestException);

      http.getProduct.mockResolvedValue(catalog);
      await expect(
        service.addProduct('deal-1', { ...phoneLine, fulfillment: 'to_order', priceClient: 90 } as any, tech),
      ).rejects.toThrow(BadRequestException);
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('prints the band in dollars with thousands separators', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, priceClient: 2000 });

      expect(await refusal(service.addProduct('deal-1', { ...phoneLine, priceClient: 1 } as any, tech))).toBe(
        'Price must be between $1,700.00 and $2,300.00 (±15% of the price book)',
      );
    });

    it('judges nothing when the price book has no price for the item', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, priceClient: undefined });

      await service.addProduct('deal-1', { ...phoneLine, priceClient: 500 } as any, tech);

      expect(products.addProduct).toHaveBeenCalled();
    });

    it('refuses an edit priced out of the band before any stock moves', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-1' }));

      expect(
        await refusal(service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 60 } as any, tech)),
      ).toBe(BAND_45);
      expect(http.restoreStock).not.toHaveBeenCalled();
      expect(http.deductStock).not.toHaveBeenCalled();
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('judges a BitCRM line by today\'s price book even when its price is unchanged', async () => {
      // The web dialog does the same: only an imported line is exempt.
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-1', priceClient: 60 }));

      await expect(
        service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 60, quantity: 2 } as any, tech),
      ).rejects.toThrow(BadRequestException);
    });

    describe('a line imported from Workiz keeps the price Workiz recorded', () => {
      const imported = (over = {}) =>
        createMockDealProduct({ fulfillment: 'imported', sourceTechId: undefined, priceClient: 99, ...over });

      it('saves an in-place edit whose price is unchanged, however far from the catalog', async () => {
        repo.findById.mockResolvedValue(onHisJob());
        products.findProduct.mockResolvedValue(imported());

        await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 99, quantity: 2 } as any, tech);

        expect(written()).toMatchObject({ priceClient: 99, quantity: 2 });
      });

      it('exempts a service line marked by priceSource as well', async () => {
        repo.findById.mockResolvedValue(onHisJob());
        products.findProduct.mockResolvedValue(
          imported({ fulfillment: 'service', priceSource: 'imported' }),
        );
        http.getProduct.mockResolvedValue({ ...catalog, type: 'service' });

        await service.replaceProduct(
          'deal-1', 'line-1',
          { ...phoneLine, fulfillment: 'service', sourceTechId: undefined, priceClient: 99 } as any,
          tech,
        );

        expect(written()).toMatchObject({ priceClient: 99 });
      });

      it('judges a new price typed on it', async () => {
        repo.findById.mockResolvedValue(onHisJob());
        products.findProduct.mockResolvedValue(imported());

        expect(
          await refusal(service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 98 } as any, tech)),
        ).toBe(BAND_45);
      });

      it('judges it once it is swapped for another item', async () => {
        repo.findById.mockResolvedValue(onHisJob());
        products.findProduct.mockResolvedValue(imported({ productId: 'product-9' }));

        await expect(
          service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 99 } as any, tech),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  /* ------------------------------------------------- no container at all */

  describe("a technician with no container gets told so, not that he is short of stock", () => {
    // Inventory answers a deduct from a technician no container resolves for
    // with 404 `Container "<id>" not found`; a short van is its 400.
    const noContainer = () => new HttpException('Container "tech-1" not found', 404);

    it('adding a sourced line — 409, nothing written', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.deductStock.mockRejectedValue(noContainer());

      const err = await service.addProduct('deal-1', phoneLine as any, tech).then(() => undefined, (e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getStatus()).toBe(409);
      expect((err as Error).message).toBe('This technician has no container assigned');
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('editing a line to be sourced from him — 409, and the old line goes back where it was', async () => {
      repo.findById.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1', 'tech-2'] }));
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-2' }));
      http.deductStock.mockRejectedValueOnce(noContainer());

      const err = await service.replaceProduct('deal-1', 'line-1', phoneLine as any, tech).then(() => undefined, (e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toBe('This technician has no container assigned');
      // Restored to tech-2's van, then taken back again by the compensation.
      expect(http.restoreStock).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(http.deductStock).toHaveBeenLastCalledWith(expect.objectContaining({ containerId: 'tech-2' }));
      expect(products.addProduct).not.toHaveBeenCalled();
    });

    it('still names the product when the van is merely short', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.deductStock.mockRejectedValue(new HttpException('Insufficient stock', 400));

      await expect(service.addProduct('deal-1', phoneLine as any, tech)).rejects.toThrow(
        `The selected technician doesn't have enough "Kwikset Deadbolt" in their container to add to this deal.`,
      );
    });
  });
});
