import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryStatus, LocationType } from '@bitcrm/types';
import { SnsPublisherService, RedisService } from '@bitcrm/shared';
import { WarehousesService } from 'src/warehouses/warehouses.service';
import { WarehousesRepository } from 'src/warehouses/warehouses.repository';
import { StockRepository } from 'src/stock/stock.repository';
import { TransfersService } from 'src/transfers/transfers.service';
import {
  createMockWarehouse,
  createMockCreateWarehouseDto,
  createMockStockItem,
  createMockJwtUser,
  createMockTransfer,
  createMockWarehousesRepository,
  createMockStockRepository,
  createMockTransfersService,
} from '../mocks';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let repository: ReturnType<typeof createMockWarehousesRepository>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;
  let transfersService: ReturnType<typeof createMockTransfersService>;

  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    repository = createMockWarehousesRepository();
    stockRepository = createMockStockRepository();
    transfersService = createMockTransfersService();

    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        { provide: WarehousesRepository, useValue: repository },
        { provide: StockRepository, useValue: stockRepository },
        { provide: TransfersService, useValue: transfersService },
        { provide: SnsPublisherService, useValue: publisher },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<WarehousesService>(WarehousesService);
  });

  describe('create', () => {
    it('should create a warehouse with UUID and ACTIVE status', async () => {
      const dto = createMockCreateWarehouseDto();
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(dto);

      expect(result.id).toBeDefined();
      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(result.name).toBe(dto.name);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: InventoryStatus.ACTIVE }),
      );
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'warehouse.created', {
        warehouseId: result.id,
      });
    });

    // Новий склад порожній, і його підсумки ведуться з першого ж запису
    // стоку — бекфіл потрібен лише рядкам, записаним до появи полів.
    it('starts the stock totals at zero, so every stock write keeps them from the first one', async () => {
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(createMockCreateWarehouseDto());

      expect(result).toMatchObject({ totalUnits: 0, uniqueItems: 0 });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalUnits: 0, uniqueItems: 0 }),
      );
    });
  });

  describe('findById', () => {
    it('should return warehouse when found', async () => {
      const warehouse = createMockWarehouse();
      repository.findById.mockResolvedValue(warehouse);

      const result = await service.findById('wh-1');

      expect(result).toEqual(warehouse);
    });

    it('should throw NotFoundException when not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      const paginated = { items: [createMockWarehouse()], nextCursor: undefined };
      repository.findAll.mockResolvedValue(paginated);

      const result = await service.list({ limit: 20 } as any);

      expect(result).toEqual(paginated);
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, {
        search: undefined,
        status: undefined,
      });
    });

    it('should default limit to 20', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({} as any);

      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, {
        search: undefined,
        status: undefined,
      });
    });

    it('passes the search term and status through', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({ limit: 20, cursor: 'c', search: 'store', status: InventoryStatus.ACTIVE } as any);

      expect(repository.findAll).toHaveBeenCalledWith(20, 'c', {
        search: 'store',
        status: InventoryStatus.ACTIVE,
      });
    });
  });

  describe('count', () => {
    it('counts the list under the same filters', async () => {
      repository.countAll.mockResolvedValue({ total: 3, atLeast: false });

      const result = await service.count({ search: 'store', status: InventoryStatus.ACTIVE } as never);

      expect(result).toEqual({ total: 3, atLeast: false });
      expect(repository.countAll).toHaveBeenCalledWith({
        search: 'store',
        status: InventoryStatus.ACTIVE,
      });
    });

    it('answers a repeat from the cache', async () => {
      repository.countAll.mockResolvedValue({ total: 3, atLeast: false });

      await service.count({} as never);
      await service.count({} as never);

      expect(repository.countAll).toHaveBeenCalledTimes(1);
    });

    it('caches each filter combination on its own', async () => {
      repository.countAll.mockResolvedValue({ total: 3, atLeast: false });

      await service.count({} as never);
      await service.count({ status: InventoryStatus.ARCHIVED } as never);

      expect(repository.countAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it('should update and return warehouse', async () => {
      const warehouse = createMockWarehouse();
      const updated = createMockWarehouse({ name: 'Updated' });
      repository.findById.mockResolvedValue(warehouse);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('wh-1', { name: 'Updated' } as any);

      expect(result).toEqual(updated);
      expect(repository.update).toHaveBeenCalledWith('wh-1', { name: 'Updated' });
    });

    it('should throw NotFoundException if warehouse does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('nonexistent', {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archive', () => {
    it('should set status to ARCHIVED', async () => {
      const archived = createMockWarehouse({ status: InventoryStatus.ARCHIVED });
      repository.update.mockResolvedValue(archived);

      const result = await service.archive('wh-1');

      expect(result.status).toBe(InventoryStatus.ARCHIVED);
      expect(repository.update).toHaveBeenCalledWith('wh-1', { status: InventoryStatus.ARCHIVED });
    });
  });

  describe('getStock', () => {
    it('should return stock levels from StockRepository', async () => {
      const warehouse = createMockWarehouse();
      const stockItems = [createMockStockItem()];
      repository.findById.mockResolvedValue(warehouse);
      stockRepository.getStockLevels.mockResolvedValue(stockItems);

      const result = await service.getStock('wh-1');

      expect(result).toEqual(stockItems);
      expect(stockRepository.getStockLevels).toHaveBeenCalledWith('WAREHOUSE#wh-1');
    });

    it('should throw NotFoundException if warehouse does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getStock('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * Один шлях отримання: POST /warehouses/:id/receive — це receive у
   * TransfersService у склад, з тими самими перевірками й журналом.
   */
  describe('receiveStock', () => {
    it('delegates to the transfers service as a receive into the warehouse and answers its transfer', async () => {
      const user = createMockJwtUser();
      const items = [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }];
      const transfer = createMockTransfer();
      transfersService.receiveStock.mockResolvedValue(transfer);

      const result = await service.receiveStock('wh-1', items, user);

      expect(transfersService.receiveStock).toHaveBeenCalledWith(
        { toType: LocationType.WAREHOUSE, toId: 'wh-1', items },
        user,
      );
      expect(result).toBe(transfer);
    });

    it('lets the transfers service answer 404 for an unknown warehouse', async () => {
      transfersService.receiveStock.mockRejectedValue(
        new NotFoundException('Warehouse "nonexistent" not found'),
      );

      await expect(
        service.receiveStock('nonexistent', [], createMockJwtUser()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
