import { NotFoundException } from '@nestjs/common';
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
      findAll: jest.fn(),
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

  describe('listAllInternal', () => {
    it('should return success with { items, nextCursor } data', async () => {
      const warehouse = createMockWarehouse();
      service.findAll.mockResolvedValue({ items: [warehouse], nextCursor: 'abc' });

      const result = await controller.listAllInternal('50', 'cur');

      expect(result).toEqual({
        success: true,
        data: { items: [warehouse], nextCursor: 'abc' },
      });
      expect(service.findAll).toHaveBeenCalledWith(50, 'cur');
    });

    it('should default limit to 200 when missing', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.listAllInternal(undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith(200, undefined);
    });

    it('should clamp limit to a max of 500', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.listAllInternal('9999');

      expect(service.findAll).toHaveBeenCalledWith(500, undefined);
    });
  });

  describe('findByIdInternal', () => {
    it('should return success with warehouse', async () => {
      const warehouse = createMockWarehouse();
      service.findById.mockResolvedValue(warehouse);

      const result = await controller.findByIdInternal('wh-1');

      expect(result).toEqual({ success: true, data: warehouse });
      expect(service.findById).toHaveBeenCalledWith('wh-1');
    });

    it('should throw NotFoundException when warehouse is null', async () => {
      service.findById.mockResolvedValue(null);

      await expect(controller.findByIdInternal('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
