import { Test, TestingModule } from '@nestjs/testing';
import { WarehousesController } from 'src/warehouses/warehouses.controller';
import { WarehousesService } from 'src/warehouses/warehouses.service';
import {
  createMockWarehouse,
  createMockCreateWarehouseDto,
  createMockStockItem,
  createMockJwtUser,
} from '../mocks';

describe('WarehousesController', () => {
  let controller: WarehousesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      getStock: jest.fn(),
      receiveStock: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WarehousesController],
      providers: [{ provide: WarehousesService, useValue: service }],
    }).compile();

    controller = module.get<WarehousesController>(WarehousesController);
  });

  describe('create', () => {
    it('should return success with created warehouse', async () => {
      const warehouse = createMockWarehouse();
      const dto = createMockCreateWarehouseDto();
      service.create.mockResolvedValue(warehouse);

      const result = await controller.create(dto);

      expect(result).toEqual({ success: true, data: warehouse });
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('list', () => {
    it('should return success with items and pagination', async () => {
      const warehouse = createMockWarehouse();
      service.list.mockResolvedValue({ items: [warehouse], nextCursor: 'abc' });

      const result = await controller.list({ limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: [warehouse],
        pagination: { nextCursor: 'abc', count: 1 },
      });
    });
  });

  describe('findById', () => {
    it('should return success with warehouse', async () => {
      const warehouse = createMockWarehouse();
      service.findById.mockResolvedValue(warehouse);

      const result = await controller.findById('wh-1');

      expect(result).toEqual({ success: true, data: warehouse });
      expect(service.findById).toHaveBeenCalledWith('wh-1');
    });
  });

  describe('update', () => {
    it('should return success with updated warehouse', async () => {
      const warehouse = createMockWarehouse({ name: 'Updated' });
      service.update.mockResolvedValue(warehouse);

      const result = await controller.update('wh-1', { name: 'Updated' } as any);

      expect(result).toEqual({ success: true, data: warehouse });
      expect(service.update).toHaveBeenCalledWith('wh-1', { name: 'Updated' });
    });
  });

  describe('archive', () => {
    it('should return success with archived warehouse', async () => {
      const warehouse = createMockWarehouse();
      service.archive.mockResolvedValue(warehouse);

      const result = await controller.archive('wh-1');

      expect(result).toEqual({ success: true, data: warehouse });
      expect(service.archive).toHaveBeenCalledWith('wh-1');
    });
  });

  describe('getStock', () => {
    it('should return success with stock items', async () => {
      const stockItems = [createMockStockItem()];
      service.getStock.mockResolvedValue(stockItems);

      const result = await controller.getStock('wh-1');

      expect(result).toEqual({ success: true, data: stockItems });
      expect(service.getStock).toHaveBeenCalledWith('wh-1');
    });
  });

  describe('receiveStock', () => {
    it('should return success after receiving stock', async () => {
      const user = createMockJwtUser();
      const items = [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }];
      service.receiveStock.mockResolvedValue(undefined);

      const result = await controller.receiveStock('wh-1', { items } as any, user);

      expect(result).toEqual({ success: true });
      expect(service.receiveStock).toHaveBeenCalledWith('wh-1', items, user);
    });
  });
});
