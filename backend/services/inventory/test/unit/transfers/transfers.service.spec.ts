import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TransferType, LocationType } from '@bitcrm/types';
import { SnsPublisherService } from '@bitcrm/shared';
import { TransfersService } from 'src/transfers/transfers.service';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import { StockService } from 'src/stock/stock.service';
import { ContainersRepository } from 'src/containers/containers.repository';
import { ProductsService } from 'src/products/products.service';
import {
  createMockTransfer,
  createMockCreateTransferDto,
  createMockJwtUser,
  createMockTransfersRepository,
  createMockStockService,
  createMockProductsService,
} from '../mocks';

describe('TransfersService', () => {
  let service: TransfersService;
  let repository: ReturnType<typeof createMockTransfersRepository>;
  let stockService: ReturnType<typeof createMockStockService>;
  let containersRepository: { findByTechnicianId: jest.Mock };
  let productsService: ReturnType<typeof createMockProductsService>;

  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    repository = createMockTransfersRepository();
    stockService = createMockStockService();
    productsService = createMockProductsService();
    // Default: the id is not a technician id, so it's treated as a container id.
    containersRepository = { findByTechnicianId: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: TransfersRepository, useValue: repository },
        { provide: StockService, useValue: stockService },
        { provide: ContainersRepository, useValue: containersRepository },
        { provide: ProductsService, useValue: productsService },
        { provide: SnsPublisherService, useValue: publisher },
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
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'transfer.created', {
        transferId: result.id,
      });
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

    it('rejects transferring a service-type product and never touches stock', async () => {
      const dto = createMockCreateTransferDto();
      const user = createMockJwtUser();
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.createTransfer(dto, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(productsService.assertStockable).toHaveBeenCalledWith(['prod-1']);
      expect(stockService.transfer).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
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

    it('rejects deducting a service-type product before touching stock', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'svc-1', productName: 'Rekey', quantity: 1 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.deductStock(dto as any)).rejects.toThrow(BadRequestException);
      expect(productsService.assertStockable).toHaveBeenCalledWith(['svc-1']);
      expect(stockService.deduct).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should resolve a technician id to their container id before deducting', async () => {
      // The deal service passes the technician's user id; stock lives under the
      // container's own id.
      containersRepository.findByTechnicianId.mockResolvedValue({ id: 'container-xyz' });
      const dto = {
        containerId: 'tech-user-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 2 }],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      };
      stockService.deduct.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.deductStock(dto as any);

      expect(containersRepository.findByTechnicianId).toHaveBeenCalledWith('tech-user-1');
      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-xyz', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ fromId: 'container-xyz' }),
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

  /**
   * 6 643 imported product-type items have Workiz `manage = 0`: the price book
   * carries them but no stock counter exists, so a deduction would 400 with
   * "Insufficient stock" and a restore would invent stock nobody counted.
   */
  describe('non-stock-managed items (manageStock: false)', () => {
    const tracked = { productId: 'prod-1', productName: 'Deadbolt', quantity: 3 };
    const untracked = { productId: 'prod-2', productName: 'Shop rag', quantity: 1 };
    const dto = (items: unknown[]) => ({
      containerId: 'container-1',
      items,
      dealId: 'deal-1',
      performedBy: 'tech-1',
      performedByName: 'tech@test.com',
    });

    beforeEach(() => {
      stockService.deduct.mockResolvedValue(undefined);
      stockService.receive.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);
      productsService.partitionStockManaged.mockImplementation(
        async (items: { productId: string }[]) => ({
          managed: items.filter((i) => i.productId !== 'prod-2'),
          unmanaged: items.filter((i) => i.productId === 'prod-2'),
        }),
      );
    });

    it('never deducts one, and keeps it out of the transfer journal', async () => {
      await service.deductStock(dto([tracked, untracked]) as any);

      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', [tracked]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.DEDUCT, items: [tracked] }),
      );
    });

    it('never restores one either — what was not deducted does not come back', async () => {
      await service.restoreStock(dto([tracked, untracked]) as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', [tracked]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.RESTORE, items: [tracked] }),
      );
    });

    it('does nothing at all when every item is untracked', async () => {
      await service.deductStock(dto([untracked]) as any);

      expect(stockService.deduct).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('still rejects a service line before looking at manageStock', async () => {
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.deductStock(dto([untracked]) as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(productsService.partitionStockManaged).not.toHaveBeenCalled();
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
