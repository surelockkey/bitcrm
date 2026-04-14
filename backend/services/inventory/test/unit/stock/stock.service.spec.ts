import { Test, TestingModule } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { StockService } from 'src/stock/stock.service';
import { StockRepository } from 'src/stock/stock.repository';
import { createMockStockRepository, createMockDynamoDbService } from '../mocks';

describe('StockService', () => {
  let service: StockService;
  let stockRepository: ReturnType<typeof createMockStockRepository>;

  beforeEach(async () => {
    stockRepository = createMockStockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: StockRepository, useValue: stockRepository },
        { provide: DynamoDbService, useValue: createMockDynamoDbService() },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  describe('receive', () => {
    it('should increment stock for each item', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 5 },
        { productId: 'prod-2', productName: 'Product 2', quantity: 10 },
      ];
      stockRepository.incrementStock.mockResolvedValue(undefined);

      await service.receive('WAREHOUSE#wh-1', items);

      expect(stockRepository.incrementStock).toHaveBeenCalledTimes(2);
      expect(stockRepository.incrementStock).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1', 'prod-1', 'Product 1', 5,
      );
      expect(stockRepository.incrementStock).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1', 'prod-2', 'Product 2', 10,
      );
    });

    it('should handle empty items array', async () => {
      await service.receive('WAREHOUSE#wh-1', []);

      expect(stockRepository.incrementStock).not.toHaveBeenCalled();
    });
  });

  describe('deduct', () => {
    it('should decrement stock for each item', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 3 },
        { productId: 'prod-2', productName: 'Product 2', quantity: 7 },
      ];
      stockRepository.decrementStock.mockResolvedValue(undefined);

      await service.deduct('CONTAINER#container-1', items);

      expect(stockRepository.decrementStock).toHaveBeenCalledTimes(2);
      expect(stockRepository.decrementStock).toHaveBeenCalledWith(
        'CONTAINER#container-1', 'prod-1', 3,
      );
      expect(stockRepository.decrementStock).toHaveBeenCalledWith(
        'CONTAINER#container-1', 'prod-2', 7,
      );
    });

    it('should handle empty items array', async () => {
      await service.deduct('CONTAINER#container-1', []);

      expect(stockRepository.decrementStock).not.toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    it('should decrement source and increment destination for each item', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 5 },
      ];
      stockRepository.decrementStock.mockResolvedValue(undefined);
      stockRepository.incrementStock.mockResolvedValue(undefined);

      await service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items);

      expect(stockRepository.decrementStock).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1', 'prod-1', 5,
      );
      expect(stockRepository.incrementStock).toHaveBeenCalledWith(
        'CONTAINER#container-1', 'prod-1', 'Product 1', 5,
      );
    });

    it('should process multiple items in order', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 2 },
        { productId: 'prod-2', productName: 'Product 2', quantity: 4 },
      ];
      stockRepository.decrementStock.mockResolvedValue(undefined);
      stockRepository.incrementStock.mockResolvedValue(undefined);

      await service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items);

      expect(stockRepository.decrementStock).toHaveBeenCalledTimes(2);
      expect(stockRepository.incrementStock).toHaveBeenCalledTimes(2);
    });

    it('should not increment if decrement fails', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 100 },
      ];
      stockRepository.decrementStock.mockRejectedValue(new Error('Insufficient stock'));

      await expect(
        service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items),
      ).rejects.toThrow('Insufficient stock');

      expect(stockRepository.incrementStock).not.toHaveBeenCalled();
    });
  });
});
