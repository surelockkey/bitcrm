import { Test } from '@nestjs/testing';
import { DealStage } from '@bitcrm/types';
import { DealsController } from 'src/deals/deals.controller';
import { DealsService } from 'src/deals/deals.service';
import { createMockDeal, createMockDealProduct, createMockJwtUser, createMockTimelineEntry } from '../mocks';

describe('DealsController', () => {
  let controller: DealsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      changeStage: jest.fn(),
      getAllowedStages: jest.fn(),
      getTimeline: jest.fn(),
      addNote: jest.fn(),
      getQualifiedTechs: jest.fn(),
      assignTech: jest.fn(),
      unassignTech: jest.fn(),
      addProduct: jest.fn(),
      removeProduct: jest.fn(),
      getProducts: jest.fn(),
      getTechDeals: jest.fn(),
      updatePaymentStatus: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [DealsController],
      providers: [{ provide: DealsService, useValue: service }],
    }).compile();

    controller = module.get(DealsController);
  });

  describe('create', () => {
    it('should return success wrapper with created deal', async () => {
      const deal = createMockDeal();
      const caller = createMockJwtUser();
      service.create.mockResolvedValue(deal);

      const result = await controller.create({} as any, caller);

      expect(result).toEqual({ success: true, data: deal });
      expect(service.create).toHaveBeenCalledWith({}, caller);
    });
  });

  describe('list', () => {
    it('should return paginated result with data scope', async () => {
      const deals = [createMockDeal()];
      const caller = createMockJwtUser();
      const perms = { dataScope: { deals: 'all' }, dealStageTransitions: ['*->*'] };
      service.list.mockResolvedValue({ items: deals, nextCursor: 'next' });

      const result = await controller.list({} as any, caller, perms as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(deals);
      expect(result.pagination).toEqual({ nextCursor: 'next', count: 1 });
      expect(service.list).toHaveBeenCalledWith({}, caller, 'all');
    });

    it('should handle undefined perms', async () => {
      service.list.mockResolvedValue({ items: [], nextCursor: undefined });
      const caller = createMockJwtUser();

      const result = await controller.list({} as any, caller, undefined as any);

      expect(result.success).toBe(true);
      expect(service.list).toHaveBeenCalledWith({}, caller, undefined);
    });
  });

  describe('findById', () => {
    it('should return deal by ID', async () => {
      const deal = createMockDeal();
      service.findById.mockResolvedValue(deal);

      const result = await controller.findById('deal-1');

      expect(result).toEqual({ success: true, data: deal });
    });
  });

  describe('update', () => {
    it('should call service.update and return result', async () => {
      const deal = createMockDeal();
      const caller = createMockJwtUser();
      service.update.mockResolvedValue(deal);

      const result = await controller.update('deal-1', { notes: 'x' } as any, caller);

      expect(result).toEqual({ success: true, data: deal });
      expect(service.update).toHaveBeenCalledWith('deal-1', { notes: 'x' }, caller);
    });
  });

  describe('softDelete', () => {
    it('should return success on delete', async () => {
      const caller = createMockJwtUser();
      service.softDelete.mockResolvedValue(undefined);

      const result = await controller.softDelete('deal-1', caller);

      expect(result).toEqual({ success: true, data: { id: 'deal-1', deleted: true } });
    });
  });

  describe('changeStage', () => {
    it('should pass dealStageTransitions from resolved permissions', async () => {
      const deal = createMockDeal({ stage: DealStage.ASSIGNED });
      const caller = createMockJwtUser();
      const perms = { dealStageTransitions: ['*->*'] };
      service.changeStage.mockResolvedValue(deal);

      const result = await controller.changeStage('deal-1', { stage: DealStage.ASSIGNED } as any, caller, perms as any);

      expect(result).toEqual({ success: true, data: deal });
      expect(service.changeStage).toHaveBeenCalledWith('deal-1', { stage: DealStage.ASSIGNED }, caller, ['*->*']);
    });

    it('should default to empty transitions when perms is undefined', async () => {
      const deal = createMockDeal();
      const caller = createMockJwtUser();
      service.changeStage.mockResolvedValue(deal);

      await controller.changeStage('deal-1', { stage: DealStage.ASSIGNED } as any, caller, undefined as any);

      expect(service.changeStage).toHaveBeenCalledWith('deal-1', { stage: DealStage.ASSIGNED }, caller, []);
    });
  });

  describe('getAllowedStages', () => {
    it('should return allowed stages', async () => {
      const perms = { dealStageTransitions: ['assigned->en_route'] };
      service.getAllowedStages.mockResolvedValue([DealStage.EN_ROUTE]);

      const result = await controller.getAllowedStages('deal-1', perms as any);

      expect(result).toEqual({ success: true, data: [DealStage.EN_ROUTE] });
      expect(service.getAllowedStages).toHaveBeenCalledWith('deal-1', ['assigned->en_route']);
    });

    it('should default to empty transitions when perms is undefined', async () => {
      service.getAllowedStages.mockResolvedValue([]);
      await controller.getAllowedStages('deal-1', undefined as any);
      expect(service.getAllowedStages).toHaveBeenCalledWith('deal-1', []);
    });
  });

  describe('getTimeline', () => {
    it('should return paginated timeline', async () => {
      const entries = [createMockTimelineEntry()];
      service.getTimeline.mockResolvedValue({ items: entries, nextCursor: undefined });

      const result = await controller.getTimeline('deal-1', 10, 'cursor');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(entries);
      expect(result.pagination).toEqual({ nextCursor: undefined, count: 1 });
      expect(service.getTimeline).toHaveBeenCalledWith('deal-1', 10, 'cursor');
    });

    it('should default limit to 20', async () => {
      service.getTimeline.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.getTimeline('deal-1');

      expect(service.getTimeline).toHaveBeenCalledWith('deal-1', 20, undefined);
    });
  });

  describe('addNote', () => {
    it('should call service.addNote', async () => {
      const caller = createMockJwtUser();
      service.addNote.mockResolvedValue(undefined);

      const result = await controller.addNote('deal-1', { note: 'Test' } as any, caller);

      expect(result).toEqual({ success: true, data: { added: true } });
      expect(service.addNote).toHaveBeenCalledWith('deal-1', { note: 'Test' }, caller);
    });
  });

  describe('getQualifiedTechs', () => {
    it('should return qualified techs', async () => {
      const techs = [{ id: 't-1', distanceMiles: 5 }];
      service.getQualifiedTechs.mockResolvedValue(techs);

      const result = await controller.getQualifiedTechs('deal-1');

      expect(result).toEqual({ success: true, data: techs });
    });
  });

  describe('assignTech', () => {
    it('should call service.assignTech', async () => {
      const deal = createMockDeal();
      const caller = createMockJwtUser();
      service.assignTech.mockResolvedValue(deal);

      const result = await controller.assignTech('deal-1', { techId: 'tech-1' } as any, caller);

      expect(result).toEqual({ success: true, data: deal });
      expect(service.assignTech).toHaveBeenCalledWith('deal-1', { techId: 'tech-1' }, caller);
    });
  });

  describe('unassignTech', () => {
    it('should call service.unassignTech', async () => {
      const deal = createMockDeal();
      const caller = createMockJwtUser();
      service.unassignTech.mockResolvedValue(deal);

      const result = await controller.unassignTech('deal-1', caller);

      expect(result).toEqual({ success: true, data: deal });
    });
  });

  describe('addProduct', () => {
    it('should call service.addProduct', async () => {
      const caller = createMockJwtUser();
      service.addProduct.mockResolvedValue(undefined);

      const dto = { productId: 'p-1', name: 'Bolt', sku: 'B-1', quantity: 1, costCompany: 10, costForTech: 15, priceClient: 30 };
      const result = await controller.addProduct('deal-1', dto as any, caller);

      expect(result).toEqual({ success: true, data: { added: true } });
      expect(service.addProduct).toHaveBeenCalledWith('deal-1', dto, caller);
    });
  });

  describe('removeProduct', () => {
    it('should call service.removeProduct', async () => {
      const caller = createMockJwtUser();
      service.removeProduct.mockResolvedValue(undefined);

      const result = await controller.removeProduct('deal-1', 'product-1', caller);

      expect(result).toEqual({ success: true, data: { removed: true } });
      expect(service.removeProduct).toHaveBeenCalledWith('deal-1', 'product-1', caller);
    });
  });

  describe('getProducts', () => {
    it('should return products for deal', async () => {
      const prods = [createMockDealProduct()];
      service.getProducts.mockResolvedValue(prods);

      const result = await controller.getProducts('deal-1');

      expect(result).toEqual({ success: true, data: prods });
    });
  });

  describe('getTechDeals (internal)', () => {
    it('should return tech deals', async () => {
      const deals = [createMockDeal()];
      service.getTechDeals.mockResolvedValue({ items: deals });

      const result = await controller.getTechDeals('tech-1');

      expect(result).toEqual({ success: true, data: deals });
    });
  });

  describe('updatePaymentStatus (internal)', () => {
    it('should call service.updatePaymentStatus', async () => {
      service.updatePaymentStatus.mockResolvedValue(undefined);

      const dto = { paymentId: 'pay-1', amount: 250, paidAt: '2026-04-20' };
      const result = await controller.updatePaymentStatus('deal-1', dto as any);

      expect(result).toEqual({ success: true, data: { updated: true } });
      expect(service.updatePaymentStatus).toHaveBeenCalledWith('deal-1', dto);
    });
  });
});
