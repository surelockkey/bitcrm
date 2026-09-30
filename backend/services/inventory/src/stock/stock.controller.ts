import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ProductStockService } from './product-stock.service';

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly productStockService: ProductStockService) {}

  @Get('products/:id')
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'Stock of one product across every location the caller may see',
    description:
      '**Guard:** `products.view` permission required. Answers `{ productId, onHand, locations }` — ' +
      'every warehouse (with `warehouses.view`), then every container the containers data scope ' +
      'allows (`assigned_only`: the caller\'s own van; `department`: their department\'s vans), ' +
      'each group in name order and inactive ones included, with the quantity held there (0 when ' +
      'the item never reached it). A Workiz placeholder location is listed (flagged `placeholder: ' +
      'true`, after the real ones of its kind) only while it still holds the item. `onHand` sums ' +
      'the rows shown. 404 when the product does not exist.',
  })
  async getProductStock(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: any,
  ) {
    const data = await this.productStockService.forProduct(id, {
      user,
      permissions: req.resolvedPermissions,
    });
    return { success: true, data };
  }
}
