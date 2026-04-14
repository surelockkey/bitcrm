import { Test, TestingModule } from '@nestjs/testing';
import { TransfersController } from 'src/transfers/transfers.controller';
import { TransfersService } from 'src/transfers/transfers.service';
import {
  createMockTransfer,
  createMockCreateTransferDto,
  createMockJwtUser,
} from '../mocks';

describe('TransfersController', () => {
  let controller: TransfersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      createTransfer: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      findByEntity: jest.fn(),
      deductStock: jest.fn(),
      restoreStock: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: service }],
    }).compile();

    controller = module.get<TransfersController>(TransfersController);
  });

  describe('create', () => {
    it('should return success with created transfer', async () => {
      const transfer = createMockTransfer();
      const dto = createMockCreateTransferDto();
      const user = createMockJwtUser();
      service.createTransfer.mockResolvedValue(transfer);

      const result = await controller.create(dto, user);

      expect(result).toEqual({ success: true, data: transfer });
      expect(service.createTransfer).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('list', () => {
    it('should return success with items and pagination', async () => {
      const transfer = createMockTransfer();
      service.list.mockResolvedValue({ items: [transfer], nextCursor: 'abc' });

      const result = await controller.list({ limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: [transfer],
        pagination: { nextCursor: 'abc', count: 1 },
      });
    });
  });

  describe('findById', () => {
    it('should return success with transfer', async () => {
      const transfer = createMockTransfer();
      service.findById.mockResolvedValue(transfer);

      const result = await controller.findById('transfer-1');

      expect(result).toEqual({ success: true, data: transfer });
      expect(service.findById).toHaveBeenCalledWith('transfer-1');
    });
  });

  describe('findByEntity', () => {
    it('should return success with items and pagination', async () => {
      const transfer = createMockTransfer();
      service.findByEntity.mockResolvedValue({ items: [transfer], nextCursor: undefined });

      const result = await controller.findByEntity('warehouse', 'wh-1', { limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: [transfer],
        pagination: { nextCursor: undefined, count: 1 },
      });
      expect(service.findByEntity).toHaveBeenCalledWith('warehouse', 'wh-1', 20, undefined);
    });
  });

  describe('deductStock', () => {
    it('should return success after deducting stock', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      service.deductStock.mockResolvedValue(undefined);

      const result = await controller.deductStock(dto as any);

      expect(result).toEqual({ success: true });
      expect(service.deductStock).toHaveBeenCalledWith(dto);
    });
  });

  describe('restoreStock', () => {
    it('should return success after restoring stock', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      service.restoreStock.mockResolvedValue(undefined);

      const result = await controller.restoreStock(dto as any);

      expect(result).toEqual({ success: true });
      expect(service.restoreStock).toHaveBeenCalledWith(dto);
    });
  });
});
