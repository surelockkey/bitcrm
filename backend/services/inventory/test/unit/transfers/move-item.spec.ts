import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LocationType } from '@bitcrm/types';
import { SnsPublisherService } from '@bitcrm/shared';
import { TransfersService } from 'src/transfers/transfers.service';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import { StockService } from 'src/stock/stock.service';
import { StockRepository } from 'src/stock/stock.repository';
import { ContainersRepository } from 'src/containers/containers.repository';
import { ProductsService } from 'src/products/products.service';
import {
  createMockJwtUser,
  createMockTransfersRepository,
  createMockStockService,
  createMockStockRepository,
  createMockContainersRepository,
  createMockProductsService,
} from '../mocks';

/**
 * Workiz's "Move Item": one product leaves one location and is split across
 * several destinations in a single action. Our transfers were one-to-one, so
 * this covers the fan-out.
 */
describe('TransfersService.moveItem', () => {
  let service: TransfersService;
  let repository: ReturnType<typeof createMockTransfersRepository>;
  let stockService: ReturnType<typeof createMockStockService>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;
  let containersRepository: ReturnType<typeof createMockContainersRepository>;
  let productsService: ReturnType<typeof createMockProductsService>;

  const user = createMockJwtUser();

  const baseDto = {
    fromType: LocationType.CONTAINER,
    fromId: 'container-1',
    productId: 'prod-1',
    productName: 'Test Product',
    destinations: [
      { toType: LocationType.CONTAINER, toId: 'container-2', quantity: 3 },
      { toType: LocationType.WAREHOUSE, toId: 'wh-1', quantity: 2 },
    ],
  };

  beforeEach(async () => {
    repository = createMockTransfersRepository();
    stockService = createMockStockService();
    stockRepository = createMockStockRepository();
    containersRepository = createMockContainersRepository();
    productsService = createMockProductsService();

    stockRepository.getStockLevel.mockResolvedValue({
      productId: 'prod-1',
      productName: 'Test Product',
      quantity: 10,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    containersRepository.findByTechnicianId.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: TransfersRepository, useValue: repository },
        { provide: StockService, useValue: stockService },
        { provide: StockRepository, useValue: stockRepository },
        { provide: ContainersRepository, useValue: containersRepository },
        { provide: ProductsService, useValue: productsService },
        { provide: SnsPublisherService, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  it('moves the product to every destination and records a leg each', async () => {
    const result = await service.moveItem(baseDto, user);

    expect(stockService.transfer).toHaveBeenCalledTimes(2);
    expect(stockService.transfer).toHaveBeenNthCalledWith(
      1,
      'CONTAINER#container-1',
      'CONTAINER#container-2',
      [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
    );
    expect(stockService.transfer).toHaveBeenNthCalledWith(
      2,
      'CONTAINER#container-1',
      'WAREHOUSE#wh-1',
      [{ productId: 'prod-1', productName: 'Test Product', quantity: 2 }],
    );
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(result.movedQuantity).toBe(5);
    expect(result.transfers).toHaveLength(2);
  });

  it('refuses to move more than the source holds', async () => {
    stockRepository.getStockLevel.mockResolvedValue({
      productId: 'prod-1',
      productName: 'Test Product',
      quantity: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(service.moveItem(baseDto, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(stockService.transfer).not.toHaveBeenCalled();
  });

  it('checks the whole total before moving anything', async () => {
    stockRepository.getStockLevel.mockResolvedValue({
      productId: 'prod-1',
      productName: 'Test Product',
      quantity: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // First leg alone would fit; the pair does not. Nothing may move.
    await expect(service.moveItem(baseDto, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(stockService.transfer).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('treats a source with no stock row as empty', async () => {
    stockRepository.getStockLevel.mockResolvedValue(null);

    await expect(service.moveItem(baseDto, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('drops zero-quantity destinations instead of writing empty legs', async () => {
    const result = await service.moveItem(
      {
        ...baseDto,
        destinations: [
          { toType: LocationType.CONTAINER, toId: 'container-2', quantity: 3 },
          { toType: LocationType.CONTAINER, toId: 'container-3', quantity: 0 },
        ],
      },
      user,
    );

    expect(stockService.transfer).toHaveBeenCalledTimes(1);
    expect(result.movedQuantity).toBe(3);
  });

  it('rejects a move where every destination is zero', async () => {
    await expect(
      service.moveItem(
        {
          ...baseDto,
          destinations: [
            { toType: LocationType.CONTAINER, toId: 'container-2', quantity: 0 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects sending the product back to its own location', async () => {
    await expect(
      service.moveItem(
        {
          ...baseDto,
          destinations: [
            { toType: LocationType.CONTAINER, toId: 'container-1', quantity: 1 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects the same destination listed twice', async () => {
    await expect(
      service.moveItem(
        {
          ...baseDto,
          destinations: [
            { toType: LocationType.CONTAINER, toId: 'container-2', quantity: 1 },
            { toType: LocationType.CONTAINER, toId: 'container-2', quantity: 2 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a non-stockable product before touching stock', async () => {
    productsService.assertStockable.mockRejectedValue(
      new BadRequestException('not stockable'),
    );

    await expect(service.moveItem(baseDto, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(stockService.transfer).not.toHaveBeenCalled();
  });
});
