import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StockController } from 'src/stock/stock.controller';
import { ProductStockService } from 'src/stock/product-stock.service';

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
      service.forProduct.mockResolvedValue(stock);

      const result = await controller.getProductStock('prod-1');

      expect(result).toEqual({ success: true, data: stock });
      expect(service.forProduct).toHaveBeenCalledWith('prod-1');
    });

    it('lets a missing product surface as 404', async () => {
      service.forProduct.mockRejectedValue(new NotFoundException('Product "x" not found'));

      await expect(controller.getProductStock('x')).rejects.toThrow(NotFoundException);
    });
  });
});
