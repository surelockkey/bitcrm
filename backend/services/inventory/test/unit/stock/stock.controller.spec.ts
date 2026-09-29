import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { StockController } from 'src/stock/stock.controller';
import { ProductStockService } from 'src/stock/product-stock.service';
import { createMockJwtUser, createMockResolvedPermissions } from '../mocks';

describe('StockController', () => {
  let controller: StockController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { forProduct: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StockController],
      providers: [{ provide: ProductStockService, useValue: service }],
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

  // Без декоратора PermissionGuard пускає будь-кого автентифікованого: сток
  // кожного фургона побачив би будь-який роль.
  it('gates the route behind products.view', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.getProductStock)).toEqual({
      resource: 'products',
      action: 'view',
    });
  });
});
