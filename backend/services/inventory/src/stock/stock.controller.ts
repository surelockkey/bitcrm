import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, hasPermission } from '@bitcrm/shared';
import { LocationType, type JwtUser } from '@bitcrm/types';
import { ProductStockService } from './product-stock.service';
import { LocationStockService } from './location-stock.service';

const LOCATION_STOCK_DESCRIPTION =
  'Answers `{ locationType, locationId, name, description?, status, placeholder?, rows }` — every ' +
  'product the location holds (quantity > 0; the partition is read to the end), each row ' +
  '`{ productId, productName, number?, sku?, category?, quantity, priceClient?, costCompany? }` ' +
  'from the catalog (a product row that is gone keeps the stock row\'s own name and no other ' +
  'fields), sorted by product name. `costCompany` is left out without `financials.view`. 404 for ' +
  'an unknown location; a Workiz placeholder is still read by id.';

/** The owner's money rule: costs only for `financials.view` (the Super Admin always). */
const mayMoney = (req: any) => hasPermission(req.resolvedPermissions, 'financials', 'view');

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(
    private readonly productStockService: ProductStockService,
    private readonly locationStockService: LocationStockService,
  ) {}

  @Get('locations/container/:id')
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: 'Everything one container holds',
    description:
      '**Guard:** `containers.view` permission required, plus the containers data scope ' +
      '(`assigned_only`: only the van the caller is assigned to; `department`: their ' +
      'department\'s vans) — 403 outside it. ' +
      LOCATION_STOCK_DESCRIPTION,
  })
  async getContainerStock(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.locationStockService.forLocation(
      LocationType.CONTAINER,
      id,
      { user, permissions: req.resolvedPermissions },
      { money: mayMoney(req) },
    );
    return { success: true, data };
  }

  @Get('locations/warehouse/:id')
  @RequirePermission('warehouses', 'view')
  @ApiOperation({
    summary: 'Everything one warehouse holds',
    description: '**Guard:** `warehouses.view` permission required. ' + LOCATION_STOCK_DESCRIPTION,
  })
  async getWarehouseStock(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.locationStockService.forLocation(
      LocationType.WAREHOUSE,
      id,
      { user, permissions: req.resolvedPermissions },
      { money: mayMoney(req) },
    );
    return { success: true, data };
  }

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
      'the rows shown; each row also carries the location\'s own `totalUnits` / `uniqueItems` ' +
      '(absent until backfilled). 404 when the product does not exist.',
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
