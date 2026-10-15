import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
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

    it('edits a line without costs: the line keeps its own (Workiz freezes the cost on the line)', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, quantity: 2 } as any, tech);

      expect(written()).toMatchObject({ quantity: 2, costCompany: 10, costForTech: 12 });
    });

    it('a swap to another item takes that item’s catalog costs, and logs the change it wrote', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(
        createMockDealProduct({ productId: 'product-0', sourceTechId: 'tech-1', costCompany: 10, costForTech: 12 }),
      );

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, costCompany: 1 } as any, tech);

      expect(written()).toMatchObject({ costCompany: 15, costForTech: 20 });
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

  /* ------------------------------------------- any price, by anyone */

  describe('a line takes any price — the technician and the office alike (owner, 2026-10-15)', () => {
    const dispatcher = createMockJwtUser({ id: 'dispatcher-1', roleId: 'role-dispatcher' });
    const admin = createMockJwtUser({ id: 'admin-1', roleId: 'role-admin' });

    /** The prices the lines were written with, in order. */
    const writtenPrices = () => products.addProduct.mock.calls.map(([, l]: [string, any]) => l.priceClient);

    it('a technician adds a line far above, far below, at zero and below zero the price book ($45)', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      for (const priceClient of [999, 1, 0, -25]) {
        await service.addProduct('deal-1', { ...phoneLine, priceClient } as any, tech, DataScope.ASSIGNED_ONLY);
      }

      expect(writtenPrices()).toEqual([999, 1, 0, -25]);
    });

    it('a technician prices a service line and a to-order line as he likes', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, type: 'service' });
      await service.addProduct('deal-1', { ...phoneLine, fulfillment: 'service', priceClient: 90 } as any, tech, DataScope.ASSIGNED_ONLY);

      // A to-order line of a product his van does not count (the container rule is not the price's).
      http.getProduct.mockResolvedValue({ ...catalog, manageStock: false });
      await service.addProduct('deal-1', { ...phoneLine, fulfillment: 'to_order', priceClient: -40 } as any, tech, DataScope.ASSIGNED_ONLY);

      expect(writtenPrices()).toEqual([90, -40]);
    });

    it('a technician edits a line to any price, below zero included', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-1' }));

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: -60 } as any, tech, DataScope.ASSIGNED_ONLY);

      expect(written()).toMatchObject({ priceClient: -60 });
    });

    it("a technician saves a line priced away from today's price book without touching its price", async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ sourceTechId: 'tech-1', priceClient: 60 }));

      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 60, quantity: 2 } as any, tech, DataScope.ASSIGNED_ONLY);

      expect(written()).toMatchObject({ priceClient: 60, quantity: 2 });
    });

    it('a technician re-prices a line imported from Workiz, and swaps it for another item at any price', async () => {
      const imported = (over = {}) =>
        createMockDealProduct({ fulfillment: 'imported', sourceTechId: undefined, priceClient: 99, ...over });
      repo.findById.mockResolvedValue(onHisJob());

      products.findProduct.mockResolvedValue(imported());
      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 98 } as any, tech, DataScope.ASSIGNED_ONLY);

      products.findProduct.mockResolvedValue(imported({ productId: 'product-9' }));
      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, priceClient: 500 } as any, tech, DataScope.ASSIGNED_ONLY);

      expect(writtenPrices()).toEqual([98, 500]);
    });

    it('a credit item of the price book (Workiz "Approved Discount" −100) takes any credit, and any charge', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      http.getProduct.mockResolvedValue({ ...catalog, type: 'service', priceClient: -100 });

      for (const priceClient of [-50, -900, 20]) {
        await service.addProduct('deal-1', { ...phoneLine, fulfillment: 'service', priceClient } as any, tech, DataScope.ASSIGNED_ONLY);
      }

      expect(writtenPrices()).toEqual([-50, -900, 20]);
    });

    it('a dispatcher (department scope) adds far above, far below and below zero', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      for (const priceClient of [999, 1, -25]) {
        await service.addProduct('deal-1', { ...phoneLine, fulfillment: 'to_order', priceClient } as any, dispatcher, DataScope.DEPARTMENT);
      }
      expect(writtenPrices()).toEqual([999, 1, -25]);
    });

    it('an admin (all scope) edits a line to a negative price', async () => {
      repo.findById.mockResolvedValue(onHisJob());
      products.findProduct.mockResolvedValue(createMockDealProduct({ fulfillment: 'to_order' }));
      await service.replaceProduct('deal-1', 'line-1', { ...phoneLine, fulfillment: 'to_order', priceClient: -100 } as any, admin, DataScope.ALL);
      expect(written()).toMatchObject({ priceClient: -100 });
    });

    it('the price is the line\'s own: the price book is only read, never written', async () => {
      repo.findById.mockResolvedValue(onHisJob());

      await service.addProduct('deal-1', { ...phoneLine, priceClient: 70 } as any, tech, DataScope.ASSIGNED_ONLY);

      expect(written()).toMatchObject({ productId: 'product-1', priceClient: 70 });
      // Inventory hears a read of the item and the van's deduction — nothing else.
      const called = Object.entries(http)
        .filter(([, fn]) => (fn as jest.Mock).mock.calls.length > 0)
        .map(([name]) => name)
        .sort();
      expect(called).toEqual(['deductStock', 'getProduct']);
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
