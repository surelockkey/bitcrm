import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TransferType, LocationType } from '@bitcrm/types';
import { TransfersService } from 'src/transfers/transfers.service';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import { StockService } from 'src/stock/stock.service';
import {
  createMockTransfer,
  createMockCreateTransferDto,
  createMockJwtUser,
  createMockTransfersRepository,
  createMockStockService,
} from '../mocks';

describe('TransfersService', () => {
  let service: TransfersService;
  let repository: ReturnType<typeof createMockTransfersRepository>;
  let stockService: ReturnType<typeof createMockStockService>;

  beforeEach(async () => {
    repository = createMockTransfersRepository();
    stockService = createMockStockService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: TransfersRepository, useValue: repository },
        { provide: StockService, useValue: stockService },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  describe('createTransfer', () => {
    it('should validate route, call StockService.transfer, and create transfer record', async () => {
      const dto = createMockCreateTransferDto();
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.id).toBeDefined();
      expect(result.type).toBe(TransferType.TRANSFER);
      expect(result.performedBy).toBe(user.id);
      expect(result.performedByName).toBe(user.email);
      expect(stockService.transfer).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1',
        'CONTAINER#container-1',
        dto.items,
      );
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('should allow container->warehouse transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: LocationType.WAREHOUSE,
        toId: 'wh-1',
      });
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.type).toBe(TransferType.TRANSFER);
    });

    it('should allow container->container transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: LocationType.CONTAINER,
        toId: 'container-2',
      });
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.type).toBe(TransferType.TRANSFER);
    });

    it('should reject invalid routes (supplier->container)', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.SUPPLIER,
        fromId: 'sup-1',
        toType: LocationType.CONTAINER,
        toId: 'container-1',
      });
      const user = createMockJwtUser();

      await expect(service.createTransfer(dto, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(stockService.transfer).not.toHaveBeenCalled();
    });

    it('should reject warehouse->warehouse transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        toType: LocationType.WAREHOUSE,
        toId: 'wh-2',
      });
      const user = createMockJwtUser();

      await expect(service.createTransfer(dto, user)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deductStock', () => {
    it('should call StockService.deduct and create DEDUCT transfer', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      stockService.deduct.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.deductStock(dto as any);

      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.DEDUCT,
          fromType: LocationType.CONTAINER,
          fromId: 'container-1',
          toType: null,
          toId: null,
          notes: 'Deal: deal-1',
        }),
      );
    });
  });

  describe('restoreStock', () => {
    it('should call StockService.receive and create RESTORE transfer', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      stockService.receive.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.restoreStock(dto as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.RESTORE,
          fromType: null,
          fromId: null,
          toType: LocationType.CONTAINER,
          toId: 'container-1',
          notes: 'Deal: deal-1',
        }),
      );
    });
  });

  describe('findById', () => {
    it('should delegate to repository', async () => {
      const transfer = createMockTransfer();
      repository.findById.mockResolvedValue(transfer);

      const result = await service.findById('transfer-1');

      expect(result).toEqual(transfer);
      expect(repository.findById).toHaveBeenCalledWith('transfer-1');
    });
  });

  describe('findByEntity', () => {
    it('should delegate to repository', async () => {
      const paginated = { items: [createMockTransfer()], nextCursor: undefined };
      repository.findByEntity.mockResolvedValue(paginated);

      const result = await service.findByEntity('warehouse', 'wh-1', 20);

      expect(result).toEqual(paginated);
      expect(repository.findByEntity).toHaveBeenCalledWith('warehouse', 'wh-1', 20, undefined);
    });
  });

  describe('list', () => {
    it('should delegate to repository with default limit', async () => {
      const paginated = { items: [createMockTransfer()], nextCursor: undefined };
      repository.findAll.mockResolvedValue(paginated);

      const result = await service.list({} as any);

      expect(result).toEqual(paginated);
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
    });

    it('should use provided limit and cursor', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({ limit: 50, cursor: 'abc' } as any);

      expect(repository.findAll).toHaveBeenCalledWith(50, 'abc');
    });
  });
});
