import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { ProductStockService } from './product-stock.service';

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly productStockService: ProductStockService) {}

  @Get('products/:id')
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'Stock of one product across every location',
    description:
      '**Guard:** `products.view` permission required. Answers `{ productId, onHand, locations }` — ' +
      'every warehouse, then every container, each group in name order and inactive ones included, ' +
      'with the quantity held there (0 when the item never reached it). 404 when the product does not exist.',
  })
  async getProductStock(@Param('id') id: string) {
    const data = await this.productStockService.forProduct(id);
    return { success: true, data };
  }
}
