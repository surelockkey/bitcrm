import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
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

  /**
   * Переміщення — один атомарний запис на позицію (обидва рядки STOCK# разом),
   * а не списання й окреме зарахування: збій між ними лишав би товар "у дорозі".
   */
  describe('transfer', () => {
    it('moves each item between the two locations in one repository write', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 5 },
      ];
      stockRepository.moveStock.mockResolvedValue(undefined);

      await service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items);

      expect(stockRepository.moveStock).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1', 'CONTAINER#container-1', 'prod-1', 'Product 1', 5,
      );
      expect(stockRepository.decrementStock).not.toHaveBeenCalled();
      expect(stockRepository.incrementStock).not.toHaveBeenCalled();
    });

    it('should process multiple items in order', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 2 },
        { productId: 'prod-2', productName: 'Product 2', quantity: 4 },
      ];
      stockRepository.moveStock.mockResolvedValue(undefined);

      await service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items);

      expect(stockRepository.moveStock.mock.calls.map((c) => c[2])).toEqual(['prod-1', 'prod-2']);
    });

    it('stops at the first item that cannot move', async () => {
      const items = [
        { productId: 'prod-1', productName: 'Product 1', quantity: 100 },
        { productId: 'prod-2', productName: 'Product 2', quantity: 1 },
      ];
      stockRepository.moveStock.mockRejectedValue(new Error('Insufficient stock'));

      await expect(
        service.transfer('WAREHOUSE#wh-1', 'CONTAINER#container-1', items),
      ).rejects.toThrow('Insufficient stock');

      expect(stockRepository.moveStock).toHaveBeenCalledTimes(1);
    });

    /**
     * Позиція 3 з 4 не проходить: 1 і 2 уже переїхали, а переміщення не
     * записане. Невдале переміщення не має рухати нічого — перші позиції
     * повертаються назад (у зворотному порядку), і летить початкова помилка.
     */
    describe('a failure part-way', () => {
      const items = [1, 2, 3, 4].map((n) => ({ productId: `prod-${n}`, productName: `P${n}`, quantity: n }));
      const insufficient = new BadRequestException('Insufficient stock for product prod-3');

      it('moves the items that already moved back, then rethrows the original error', async () => {
        stockRepository.moveStock
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(insufficient)
          .mockResolvedValue(undefined);

        await expect(service.transfer('WAREHOUSE#wh-1', 'CONTAINER#c-1', items)).rejects.toBe(insufficient);

        expect(stockRepository.moveStock.mock.calls).toEqual([
          ['WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'P1', 1],
          ['WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-2', 'P2', 2],
          ['WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-3', 'P3', 3],
          ['CONTAINER#c-1', 'WAREHOUSE#wh-1', 'prod-2', 'P2', 2],
          ['CONTAINER#c-1', 'WAREHOUSE#wh-1', 'prod-1', 'P1', 1],
        ]);
      });

      it('logs loudly when an undo fails, keeps undoing the rest, and still rethrows the original', async () => {
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        stockRepository.moveStock
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(insufficient)
          .mockRejectedValueOnce(new Error('throttled'))
          .mockResolvedValue(undefined);

        await expect(service.transfer('WAREHOUSE#wh-1', 'CONTAINER#c-1', items)).rejects.toBe(insufficient);

        expect(stockRepository.moveStock).toHaveBeenCalledTimes(5);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('prod-2'));
        errorLog.mockRestore();
      });
    });

    /** Те саме для списання кількох позицій (повернення, списання на роботу). */
    it('adds back what a deduct already took when a later item fails', async () => {
      const items = [1, 2, 3].map((n) => ({ productId: `prod-${n}`, productName: `P${n}`, quantity: n }));
      const insufficient = new BadRequestException('Insufficient stock for product prod-3');
      stockRepository.decrementStock
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(insufficient);

      await expect(service.deduct('CONTAINER#c-1', items)).rejects.toBe(insufficient);

      expect(stockRepository.incrementStock.mock.calls).toEqual([
        ['CONTAINER#c-1', 'prod-2', 'P2', 2],
        ['CONTAINER#c-1', 'prod-1', 'P1', 1],
      ]);
    });
  });
});
