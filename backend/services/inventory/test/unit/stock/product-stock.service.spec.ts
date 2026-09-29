import { NotFoundException } from '@nestjs/common';
import { DataScope, InventoryStatus, LocationType } from '@bitcrm/types';
import { ProductStockService } from 'src/stock/product-stock.service';
import { StockRepository } from 'src/stock/stock.repository';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';
import {
  createMockProduct,
  createMockProductsRepository,
  createMockLocationsRepository,
  createMockLocationSummary,
  createMockDynamoDbService,
  createMockJwtUser,
  createMockResolvedPermissions,
} from '../mocks';

/**
 * The stock icon on an inventory item opens Workiz's "Stock" popup: every
 * warehouse and van, with how many of this item each holds — the inactive
 * "N/A" vans included, at zero when nothing was ever moved there.
 */
describe('ProductStockService', () => {
  let service: ProductStockService;
  let productsRepository: ReturnType<typeof createMockProductsRepository>;
  let locationsRepository: ReturnType<typeof createMockLocationsRepository>;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  const stockRow = (pk: string, quantity: number) => ({
    PK: pk,
    SK: 'STOCK#prod-1',
    productId: 'prod-1',
    productName: 'Test Product',
    quantity,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    productsRepository = createMockProductsRepository();
    locationsRepository = createMockLocationsRepository();
    dynamoDb = createMockDynamoDbService();
    service = new ProductStockService(
      productsRepository as any,
      locationsRepository as any,
      new StockRepository(dynamoDb as any),
    );
    productsRepository.findById.mockResolvedValue(createMockProduct({ id: 'prod-1' }));
  });

  it('404s on a product that does not exist, before touching any location', async () => {
    productsRepository.findById.mockResolvedValue(null);

    await expect(service.forProduct('missing')).rejects.toThrow(NotFoundException);
    expect(locationsRepository.listAll).not.toHaveBeenCalled();
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });

  it('lists warehouses first, then containers, in index order, zero where nothing is held', async () => {
    locationsRepository.listAll.mockImplementation(async (type: LocationType) =>
      type === LocationType.WAREHOUSE
        ? [createMockLocationSummary({ type: 'warehouse', id: 'wh-1', name: '(1) STORE' })]
        : [
            createMockLocationSummary({ type: 'container', id: 'c-a', name: '(2) ANN', description: 'North' }),
            createMockLocationSummary({
              type: 'container',
              id: 'c-b',
              name: '(3) N/A',
              status: InventoryStatus.ARCHIVED,
            }),
          ],
    );
    dynamoDb.client.send.mockResolvedValue({
      Responses: {
        [INVENTORY_TABLE]: [stockRow('CONTAINER#c-b', 4), stockRow('WAREHOUSE#wh-1', 10)],
      },
    });

    const result = await service.forProduct('prod-1');

    expect(locationsRepository.listAll.mock.calls.map((c) => c[0])).toEqual([
      LocationType.WAREHOUSE,
      LocationType.CONTAINER,
    ]);
    expect(result).toEqual({
      productId: 'prod-1',
      onHand: 14,
      locations: [
        {
          locationType: 'warehouse',
          locationId: 'wh-1',
          name: '(1) STORE',
          description: undefined,
          status: InventoryStatus.ACTIVE,
          quantity: 10,
        },
        {
          locationType: 'container',
          locationId: 'c-a',
          name: '(2) ANN',
          description: 'North',
          status: InventoryStatus.ACTIVE,
          quantity: 0,
        },
        {
          locationType: 'container',
          locationId: 'c-b',
          name: '(3) N/A',
          description: undefined,
          status: InventoryStatus.ARCHIVED,
          quantity: 4,
        },
      ],
    });
  });

  it('asks for the STOCK row of this product under every location key in one batch', async () => {
    locationsRepository.listAll.mockImplementation(async (type: LocationType) =>
      type === LocationType.WAREHOUSE
        ? [createMockLocationSummary({ type: 'warehouse', id: 'wh-1' })]
        : [createMockLocationSummary({ type: 'container', id: 'c-a' })],
    );
    dynamoDb.client.send.mockResolvedValue({ Responses: { [INVENTORY_TABLE]: [] } });

    await service.forProduct('prod-1');

    const sent = dynamoDb.client.send.mock.calls[0][0];
    expect(sent.constructor.name).toBe('BatchGetCommand');
    expect(sent.input.RequestItems[INVENTORY_TABLE].Keys).toEqual([
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' },
      { PK: 'CONTAINER#c-a', SK: 'STOCK#prod-1' },
    ]);
  });

  it('answers an empty list, on hand zero, when there are no locations at all', async () => {
    locationsRepository.listAll.mockResolvedValue([]);

    const result = await service.forProduct('prod-1');

    expect(result).toEqual({ productId: 'prod-1', onHand: 0, locations: [] });
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });

  /**
   * Той самий обсяг, що й GET /containers і GET /warehouses для цього ж
   * користувача: технік бачить у попапі лише свій фургон і не бачить складів,
   * якщо warehouses.view йому не дано — інакше попап розкривав би те, що
   * списки приховують.
   */
  describe('scoped to what the caller may see', () => {
    const warehouse = createMockLocationSummary({ type: 'warehouse', id: 'wh-1', name: '(1) STORE' });
    const mine = createMockLocationSummary({
      type: 'container', id: 'c-mine', name: '(2) MINE', technicianId: 'tech-1', department: 'Atlanta',
    });
    const other = createMockLocationSummary({
      type: 'container', id: 'c-other', name: '(3) OTHER', technicianId: 'tech-2', department: 'Atlanta',
    });
    const elsewhere = createMockLocationSummary({
      type: 'container', id: 'c-else', name: '(4) ELSE', technicianId: 'tech-3', department: 'Marietta',
    });

    beforeEach(() => {
      locationsRepository.listAll.mockImplementation(async (type: LocationType) =>
        type === LocationType.WAREHOUSE ? [warehouse] : [mine, other, elsewhere],
      );
      dynamoDb.client.send.mockResolvedValue({
        Responses: { [INVENTORY_TABLE]: [stockRow('WAREHOUSE#wh-1', 10), stockRow('CONTAINER#c-other', 3)] },
      });
    });

    it('shows a technician their own van only, and no warehouse without warehouses.view', async () => {
      const user = createMockJwtUser({ id: 'tech-1', department: 'Atlanta' });
      const permissions = createMockResolvedPermissions({
        permissions: {
          products: { view: true },
          warehouses: { view: false },
          containers: { view: true },
        },
        dataScope: { warehouses: DataScope.ASSIGNED_ONLY, containers: DataScope.ASSIGNED_ONLY },
      });

      const result = await service.forProduct('prod-1', { user, permissions });

      expect(result.locations.map((l) => l.locationId)).toEqual(['c-mine']);
      expect(result.onHand).toBe(0);
      // Only the visible rows are asked for.
      expect(dynamoDb.client.send.mock.calls[0][0].input.RequestItems[INVENTORY_TABLE].Keys).toEqual([
        { PK: 'CONTAINER#c-mine', SK: 'STOCK#prod-1' },
      ]);
    });

    it('shows a department-scoped caller the vans of their department, and the warehouses they may view', async () => {
      const user = createMockJwtUser({ id: 'disp-1', department: 'Atlanta' });
      const permissions = createMockResolvedPermissions({
        dataScope: { warehouses: DataScope.ALL, containers: DataScope.DEPARTMENT },
      });

      const result = await service.forProduct('prod-1', { user, permissions });

      expect(result.locations.map((l) => l.locationId)).toEqual(['wh-1', 'c-mine', 'c-other']);
      expect(result.onHand).toBe(13);
    });

    it('shows everything to a caller scoped to all', async () => {
      const result = await service.forProduct('prod-1', {
        user: createMockJwtUser(),
        permissions: createMockResolvedPermissions(),
      });

      expect(result.locations.map((l) => l.locationId)).toEqual(['wh-1', 'c-mine', 'c-other', 'c-else']);
    });

    it('shows everything to the super admin, as the guard does', async () => {
      const permissions = createMockResolvedPermissions({
        roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {},
      });

      const result = await service.forProduct('prod-1', { user: createMockJwtUser(), permissions });

      expect(result.locations).toHaveLength(4);
    });
  });

  // BatchGet takes 100 keys a call and may hand some back unprocessed under load.
  it('chunks the batch at 100 keys and asks again for the keys DynamoDB left unprocessed', async () => {
    const containers = Array.from({ length: 120 }, (_, i) =>
      createMockLocationSummary({ type: 'container', id: `c-${String(i).padStart(3, '0')}` }),
    );
    locationsRepository.listAll.mockImplementation(async (type: LocationType) =>
      type === LocationType.WAREHOUSE ? [] : containers,
    );
    dynamoDb.client.send
      // First chunk: one row answered, one key deferred.
      .mockResolvedValueOnce({
        Responses: { [INVENTORY_TABLE]: [stockRow('CONTAINER#c-000', 1)] },
        UnprocessedKeys: {
          [INVENTORY_TABLE]: { Keys: [{ PK: 'CONTAINER#c-099', SK: 'STOCK#prod-1' }] },
        },
      })
      // The retry of the deferred key.
      .mockResolvedValueOnce({
        Responses: { [INVENTORY_TABLE]: [stockRow('CONTAINER#c-099', 2)] },
        UnprocessedKeys: {},
      })
      // Second chunk.
      .mockResolvedValueOnce({
        Responses: { [INVENTORY_TABLE]: [stockRow('CONTAINER#c-119', 3)] },
      });

    const result = await service.forProduct('prod-1');

    const calls = dynamoDb.client.send.mock.calls.map((c) => c[0].input.RequestItems[INVENTORY_TABLE].Keys);
    expect(calls.map((k) => k.length)).toEqual([100, 1, 20]);
    expect(calls[1]).toEqual([{ PK: 'CONTAINER#c-099', SK: 'STOCK#prod-1' }]);
    expect(calls[2][0]).toEqual({ PK: 'CONTAINER#c-100', SK: 'STOCK#prod-1' });
    expect(result.onHand).toBe(6);
    expect(result.locations).toHaveLength(120);
    expect(result.locations.find((l) => l.locationId === 'c-099')!.quantity).toBe(2);
    expect(result.locations.find((l) => l.locationId === 'c-119')!.quantity).toBe(3);
    expect(result.locations.find((l) => l.locationId === 'c-050')!.quantity).toBe(0);
  });
});
