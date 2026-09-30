import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { StockController } from 'src/stock/stock.controller';
import { ProductStockService } from 'src/stock/product-stock.service';
import { LocationStockService } from 'src/stock/location-stock.service';
import { LocationType } from '@bitcrm/types';
import { createMockJwtUser, createMockResolvedPermissions } from '../mocks';

describe('StockController', () => {
  let controller: StockController;
  let service: Record<string, jest.Mock>;
  let locationStock: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { forProduct: jest.fn() };
    locationStock = { forLocation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StockController],
      providers: [
        { provide: ProductStockService, useValue: service },
        { provide: LocationStockService, useValue: locationStock },
      ],
    }).compile();

    controller = module.get<StockController>(StockController);
  });

  describe('getProductStock', () => {
    it('should return success with the stock of the product across locations', async () => {
      const stock = { productId: 'prod-1', onHand: 3, locations: [] };
      const user = createMockJwtUser();
      const permissions = createMockResolvedPermissions();
      service.forProduct.mockResolvedValue(stock);

      const result = await controller.getProductStock('prod-1', user, { resolvedPermissions: permissions });

      expect(result).toEqual({ success: true, data: stock });
      expect(service.forProduct).toHaveBeenCalledWith('prod-1', { user, permissions });
    });

    it('lets a missing product surface as 404', async () => {
      service.forProduct.mockRejectedValue(new NotFoundException('Product "x" not found'));

      await expect(controller.getProductStock('x', createMockJwtUser(), {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /** Сток однієї локації: склад за warehouses.view, фургон за containers.view (+ обсяг у сервісі). */
  describe('location stock', () => {
    const user = createMockJwtUser();
    const permissions = createMockResolvedPermissions();
    const data = { locationType: 'container', locationId: 'c-1', name: 'Van', status: 'active', rows: [] };

    it('answers a container’s stock for the caller', async () => {
      locationStock.forLocation.mockResolvedValue(data);

      expect(await controller.getContainerStock('c-1', user, { resolvedPermissions: permissions })).toEqual({
        success: true,
        data,
      });
      expect(locationStock.forLocation).toHaveBeenCalledWith(
        LocationType.CONTAINER,
        'c-1',
        { user, permissions },
        { money: false },
      );
    });

    // Правило власника: без financials.view сервер не віддає собівартість.
    it('asks for costs only with financials.view (the Super Admin always)', async () => {
      locationStock.forLocation.mockResolvedValue(data);
      const withMoney = createMockResolvedPermissions({
        permissions: { warehouses: { view: true }, financials: { view: true } },
      });
      const superAdmin = createMockResolvedPermissions({ isSystemRole: true, roleName: 'Super Admin', permissions: {} });

      await controller.getWarehouseStock('wh-1', user, { resolvedPermissions: withMoney });
      await controller.getContainerStock('c-1', user, { resolvedPermissions: superAdmin });

      expect(locationStock.forLocation.mock.calls.map((c) => c[3])).toEqual([{ money: true }, { money: true }]);
    });

    it('answers a warehouse’s stock for the caller', async () => {
      locationStock.forLocation.mockResolvedValue(data);

      await controller.getWarehouseStock('wh-1', user, { resolvedPermissions: permissions });

      expect(locationStock.forLocation).toHaveBeenCalledWith(
        LocationType.WAREHOUSE,
        'wh-1',
        { user, permissions },
        { money: false },
      );
    });

    it('gates each kind behind its own view permission', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, controller.getContainerStock)).toEqual({
        resource: 'containers',
        action: 'view',
      });
      expect(Reflect.getMetadata(PERMISSION_KEY, controller.getWarehouseStock)).toEqual({
        resource: 'warehouses',
        action: 'view',
      });
      expect(Reflect.getMetadata('path', controller.getContainerStock)).toBe('locations/container/:id');
      expect(Reflect.getMetadata('path', controller.getWarehouseStock)).toBe('locations/warehouse/:id');
    });
  });

  // Без декоратора PermissionGuard пускає будь-кого автентифікованого: сток
  // кожного фургона побачив би будь-який роль.
  it('gates the route behind products.view', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.getProductStock)).toEqual({
      resource: 'products',
      action: 'view',
    });
  });
});
