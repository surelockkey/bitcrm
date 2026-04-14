import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryStatus, TransferType, LocationType } from '@bitcrm/types';
import { WarehousesService } from 'src/warehouses/warehouses.service';
import { WarehousesRepository } from 'src/warehouses/warehouses.repository';
import { StockService } from 'src/stock/stock.service';
import { StockRepository } from 'src/stock/stock.repository';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import {
  createMockWarehouse,
  createMockCreateWarehouseDto,
  createMockStockItem,
  createMockJwtUser,
  createMockWarehousesRepository,
  createMockStockService,
  createMockStockRepository,
  createMockTransfersRepository,
} from '../mocks';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let repository: ReturnType<typeof createMockWarehousesRepository>;
  let stockService: ReturnType<typeof createMockStockService>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;
  let transfersRepository: ReturnType<typeof createMockTransfersRepository>;

  beforeEach(async () => {
    repository = createMockWarehousesRepository();
    stockService = createMockStockService();
    stockRepository = createMockStockRepository();
    transfersRepository = createMockTransfersRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        { provide: WarehousesRepository, useValue: repository },
        { provide: StockService, useValue: stockService },
        { provide: StockRepository, useValue: stockRepository },
        { provide: TransfersRepository, useValue: transfersRepository },
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
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
    });

    it('should default limit to 20', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({} as any);

      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
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

  describe('receiveStock', () => {
    it('should call StockService.receive and create transfer record', async () => {
      const warehouse = createMockWarehouse();
      const user = createMockJwtUser();
      const items = [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }];
      repository.findById.mockResolvedValue(warehouse);
      stockService.receive.mockResolvedValue(undefined);
      transfersRepository.create.mockResolvedValue(undefined);

      await service.receiveStock('wh-1', items, user);

      expect(stockService.receive).toHaveBeenCalledWith('WAREHOUSE#wh-1', items);
      expect(transfersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.RECEIVE,
          fromType: LocationType.SUPPLIER,
          fromId: null,
          toType: LocationType.WAREHOUSE,
          toId: 'wh-1',
          items,
          performedBy: user.id,
          performedByName: user.email,
        }),
      );
    });

    it('should throw NotFoundException if warehouse does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.receiveStock('nonexistent', [], createMockJwtUser()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
