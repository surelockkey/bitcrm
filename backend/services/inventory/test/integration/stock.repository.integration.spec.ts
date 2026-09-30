import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { StockRepository } from 'src/stock/stock.repository';
import {
  createTestTable,
  clearTestTable,
  getTestDynamoDbClient,
} from './setup';

jest.mock('../../src/common/constants/dynamo.constants', () => ({
  INVENTORY_TABLE: 'BitCRM_Inventory_Test',
  GSI1_NAME: 'CategoryIndex',
  GSI2_NAME: 'TypeIndex',
  GSI3_NAME: 'OwnerIndex',
  GSI4_NAME: 'TransferEntityIndex',
}));

describe('StockRepository (integration)', () => {
  let repository: StockRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const WAREHOUSE_PK = 'WAREHOUSE#wh-1';

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        StockRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(StockRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('incrementStock', () => {
    it('should create stock item if not exists', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Test Product', 10);

      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'prod-1');

      expect(stock).not.toBeNull();
      expect(stock!.productId).toBe('prod-1');
      expect(stock!.productName).toBe('Test Product');
      expect(stock!.quantity).toBe(10);
    });

    it('should add to existing quantity', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Test Product', 10);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Test Product', 5);

      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'prod-1');

      expect(stock).not.toBeNull();
      expect(stock!.quantity).toBe(15);
    });
  });

  describe('getStockLevel', () => {
    it('should return correct stock item', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Product A', 10);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-2', 'Product B', 20);

      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'prod-1');

      expect(stock).not.toBeNull();
      expect(stock!.productId).toBe('prod-1');
      expect(stock!.quantity).toBe(10);
    });

    it('should return null for nonexistent stock', async () => {
      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'nonexistent');
      expect(stock).toBeNull();
    });
  });

  describe('getStockLevels', () => {
    it('should return all stock for entity', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Product A', 10);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-2', 'Product B', 20);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-3', 'Product C', 30);

      const stocks = await repository.getStockLevels(WAREHOUSE_PK);

      expect(stocks).toHaveLength(3);
      const totalQty = stocks.reduce((sum, s) => sum + s.quantity, 0);
      expect(totalQty).toBe(60);
    });

    it('should return empty for entity with no stock', async () => {
      const stocks = await repository.getStockLevels('WAREHOUSE#empty');
      expect(stocks).toHaveLength(0);
    });
  });

  describe('decrementStock', () => {
    it('should reduce quantity', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Product A', 10);

      await repository.decrementStock(WAREHOUSE_PK, 'prod-1', 3);

      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'prod-1');
      expect(stock).not.toBeNull();
      expect(stock!.quantity).toBe(7);
    });

    it('should allow decrement to zero', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Product A', 5);

      await repository.decrementStock(WAREHOUSE_PK, 'prod-1', 5);

      const stock = await repository.getStockLevel(WAREHOUSE_PK, 'prod-1');
      expect(stock).not.toBeNull();
      expect(stock!.quantity).toBe(0);
    });

    it('should throw BadRequestException when insufficient stock', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'Product A', 5);

      await expect(
        repository.decrementStock(WAREHOUSE_PK, 'prod-1', 10),
      ).rejects.toThrow('Insufficient stock');
    });

    it('should throw when stock item does not exist', async () => {
      await expect(
        repository.decrementStock(WAREHOUSE_PK, 'nonexistent', 1),
      ).rejects.toThrow();
    });
  });

  /**
   * `totalUnits` / `uniqueItems` на рядку локації рухаються тією ж
   * транзакцією, що й рядок STOCK# — перевірка реальних виразів DynamoDB,
   * яких модульні тести з моками не бачать.
   */
  describe('location totals', () => {
    const TABLE = 'BitCRM_Inventory_Test';
    const CONTAINER_PK = 'CONTAINER#c-1';

    const putLocation = (pk: string, totals?: { totalUnits: number; uniqueItems: number }) =>
      dbClient.send(
        new PutCommand({ TableName: TABLE, Item: { PK: pk, SK: 'METADATA', id: pk.split('#')[1], ...totals } }),
      );
    const totalsOf = async (pk: string) => {
      const { Item } = await dbClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }));
      return { totalUnits: Item?.totalUnits, uniqueItems: Item?.uniqueItems };
    };

    beforeEach(async () => {
      await putLocation(WAREHOUSE_PK, { totalUnits: 0, uniqueItems: 0 });
      await putLocation(CONTAINER_PK, { totalUnits: 0, uniqueItems: 0 });
    });

    it('counts units and distinct products as stock comes and goes', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'A', 10);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'A', 5);
      await repository.incrementStock(WAREHOUSE_PK, 'prod-2', 'B', 1);
      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: 16, uniqueItems: 2 });

      await repository.decrementStock(WAREHOUSE_PK, 'prod-2', 1);
      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: 15, uniqueItems: 1 });

      // A row at zero comes back into the count.
      await repository.incrementStock(WAREHOUSE_PK, 'prod-2', 'B', 3);
      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: 18, uniqueItems: 2 });
    });

    it('moves both locations in one go', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'A', 4);

      await repository.moveStock(WAREHOUSE_PK, CONTAINER_PK, 'prod-1', 'A', 4);

      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: 0, uniqueItems: 0 });
      expect(await totalsOf(CONTAINER_PK)).toEqual({ totalUnits: 4, uniqueItems: 1 });
    });

    it('leaves the totals alone when a take is refused', async () => {
      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'A', 2);

      await expect(repository.decrementStock(WAREHOUSE_PK, 'prod-1', 3)).rejects.toThrow('Insufficient stock');
      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: 2, uniqueItems: 1 });
    });

    it('never invents totals on a location the backfill has not reached', async () => {
      await putLocation(WAREHOUSE_PK);

      await repository.incrementStock(WAREHOUSE_PK, 'prod-1', 'A', 7);

      expect(await totalsOf(WAREHOUSE_PK)).toEqual({ totalUnits: undefined, uniqueItems: undefined });
      expect((await repository.getStockLevel(WAREHOUSE_PK, 'prod-1'))!.quantity).toBe(7);
    });
  });
});
