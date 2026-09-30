import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataScope, InventoryStatus, LocationType } from '@bitcrm/types';
import { LocationStockService } from 'src/stock/location-stock.service';
import {
  createMockContainerAssignmentResolver,
  createMockJwtUser,
  createMockLocationSummary,
  createMockLocationsRepository,
  createMockProduct,
  createMockProductsRepository,
  createMockResolvedPermissions,
  createMockStockItem,
  createMockStockRepository,
} from '../mocks';

/**
 * Попап Stock фургона чи складу: веб з'єднував сток локації з усім каталогом
 * складських товарів (3 102 товари → 32 послідовні запити, понад 8 с). Тепер
 * один маршрут: рядки STOCK# локації до кінця, лише з кількістю > 0, і поля
 * товарів одним BatchGet на 100 ключів.
 */
describe('LocationStockService', () => {
  let locations: ReturnType<typeof createMockLocationsRepository>;
  let stock: ReturnType<typeof createMockStockRepository>;
  let products: ReturnType<typeof createMockProductsRepository>;
  let assignments: ReturnType<typeof createMockContainerAssignmentResolver>;
  let service: LocationStockService;

  const van = createMockLocationSummary({
    type: 'container', id: 'c-1', name: '(12) MIKE', description: 'North', department: 'Atlanta',
  });

  beforeEach(() => {
    locations = createMockLocationsRepository();
    stock = createMockStockRepository();
    products = createMockProductsRepository();
    assignments = createMockContainerAssignmentResolver();
    service = new LocationStockService(locations as any, stock as any, products as any, assignments as any);
    locations.findLocation.mockResolvedValue(van);
    stock.getStockLevels.mockResolvedValue([]);
  });

  it('answers the location with its non-zero stock, enriched from the catalog, by product name', async () => {
    stock.getStockLevels.mockResolvedValue([
      createMockStockItem({ productId: 'p-z', productName: 'old zeta', quantity: 2 }),
      createMockStockItem({ productId: 'p-empty', productName: 'Gone to zero', quantity: 0 }),
      createMockStockItem({ productId: 'p-a', productName: 'old alpha', quantity: 5 }),
    ]);
    products.findByIds.mockResolvedValue([
      createMockProduct({ id: 'p-a', name: 'Alpha lock', number: 12, sku: 'A-1', category: 'Locks', priceClient: 30, costCompany: 11 }),
      createMockProduct({ id: 'p-z', name: 'Zeta hinge', number: 13, sku: 'Z-1', category: 'Hinges', priceClient: 8, costCompany: 3 }),
    ]);

    const result = await service.forLocation(LocationType.CONTAINER, 'c-1', undefined, { money: true });

    expect(locations.findLocation).toHaveBeenCalledWith(LocationType.CONTAINER, 'c-1');
    expect(stock.getStockLevels).toHaveBeenCalledWith('CONTAINER#c-1');
    expect(products.findByIds).toHaveBeenCalledWith(['p-z', 'p-a']);
    expect(result).toEqual({
      locationType: 'container',
      locationId: 'c-1',
      name: '(12) MIKE',
      description: 'North',
      status: InventoryStatus.ACTIVE,
      rows: [
        { productId: 'p-a', productName: 'Alpha lock', number: 12, sku: 'A-1', category: 'Locks', quantity: 5, priceClient: 30, costCompany: 11 },
        { productId: 'p-z', productName: 'Zeta hinge', number: 13, sku: 'Z-1', category: 'Hinges', quantity: 2, priceClient: 8, costCompany: 3 },
      ],
    });
  });

  // Правило власника: без financials.view собівартість не віддається.
  it('leaves costCompany out of every row unless the caller may see money, keeping the price', async () => {
    stock.getStockLevels.mockResolvedValue([createMockStockItem({ productId: 'p-a', quantity: 5 })]);
    products.findByIds.mockResolvedValue([
      createMockProduct({ id: 'p-a', name: 'Alpha lock', priceClient: 30, costCompany: 11 }),
    ]);

    const result = await service.forLocation(LocationType.CONTAINER, 'c-1');

    expect(result.rows[0]).not.toHaveProperty('costCompany');
    expect(result.rows[0].priceClient).toBe(30);
  });

  it('keeps a stock row whose product row is gone, under the name the stock row stored', async () => {
    locations.findLocation.mockResolvedValue(createMockLocationSummary({ type: 'warehouse', id: 'wh-1' }));
    stock.getStockLevels.mockResolvedValue([createMockStockItem({ productId: 'p-gone', productName: 'Old part', quantity: 4 })]);
    products.findByIds.mockResolvedValue([]);

    const result = await service.forLocation(LocationType.WAREHOUSE, 'wh-1');

    expect(stock.getStockLevels).toHaveBeenCalledWith('WAREHOUSE#wh-1');
    expect(result.rows).toEqual([{ productId: 'p-gone', productName: 'Old part', quantity: 4 }]);
  });

  it('reads no product for a location that holds nothing', async () => {
    const result = await service.forLocation(LocationType.CONTAINER, 'c-1');

    expect(result.rows).toEqual([]);
    expect(products.findByIds).not.toHaveBeenCalled();
  });

  it('404s on a location that does not exist, before reading stock', async () => {
    locations.findLocation.mockResolvedValue(null);

    await expect(service.forLocation(LocationType.CONTAINER, 'nope')).rejects.toThrow(NotFoundException);
    expect(stock.getStockLevels).not.toHaveBeenCalled();
  });

  it('still answers a Workiz placeholder read by id, flagged', async () => {
    locations.findLocation.mockResolvedValue({ ...van, placeholder: true });

    expect((await service.forLocation(LocationType.CONTAINER, 'c-1')).placeholder).toBe(true);
  });

  /** Ті самі правила обсягу, що й у списку контейнерів і попапі стоку товару. */
  describe('scope', () => {
    const technician = createMockResolvedPermissions({
      permissions: { products: { view: true }, warehouses: { view: false }, containers: { view: true } },
      dataScope: { containers: DataScope.ASSIGNED_ONLY },
    });
    const dispatcher = createMockResolvedPermissions({ dataScope: { containers: DataScope.DEPARTMENT } });

    it('lets a technician read the van they are assigned to', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-1');

      await expect(
        service.forLocation(LocationType.CONTAINER, 'c-1', { user: createMockJwtUser({ id: 'tech-1' }), permissions: technician }),
      ).resolves.toBeDefined();
      expect(assignments.containerIdForUser).toHaveBeenCalledWith('tech-1');
    });

    it('lets a technician with "All locations" read any van', async () => {
      assignments.assignmentFor.mockResolvedValue({ allLocations: true });

      await expect(
        service.forLocation(LocationType.CONTAINER, 'c-1', { user: createMockJwtUser({ id: 'tech-1' }), permissions: technician }),
      ).resolves.toBeDefined();
    });

    it('refuses a technician another van with a 403, before reading stock', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-other');

      await expect(
        service.forLocation(LocationType.CONTAINER, 'c-1', { user: createMockJwtUser({ id: 'tech-1' }), permissions: technician }),
      ).rejects.toThrow(ForbiddenException);
      expect(stock.getStockLevels).not.toHaveBeenCalled();
    });

    it('keeps a department-scoped caller to their department’s vans', async () => {
      await expect(
        service.forLocation(LocationType.CONTAINER, 'c-1', {
          user: createMockJwtUser({ department: 'Marietta' }),
          permissions: dispatcher,
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.forLocation(LocationType.CONTAINER, 'c-1', {
          user: createMockJwtUser({ department: 'Atlanta' }),
          permissions: dispatcher,
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a warehouse to a caller without warehouses.view', async () => {
      locations.findLocation.mockResolvedValue(createMockLocationSummary({ type: 'warehouse', id: 'wh-1' }));

      await expect(
        service.forLocation(LocationType.WAREHOUSE, 'wh-1', { user: createMockJwtUser(), permissions: technician }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
