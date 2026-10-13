import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { ProductListService } from './product-list.service';
import { parseProductListInput } from './product-list.query';

@ApiTags('search-internal')
@Controller('internal/products')
export class ProductListController {
  constructor(private readonly productList: ProductListService) {}

  @Post('query')
  @Internal()
  @HttpCode(200)
  @ApiOperation({
    summary: "Inventory's filtered Price Book, off the read model (internal)",
    description:
      '**Guard:** internal service-to-service only (`x-internal-secret` header). Body ' +
      '`{ partition: catalog|stock, mode: page|count, filters: { type, status, search, brandId, ' +
      'manageStock, stockLevel }, limit (1..100), after? }` — the filters of `GET /inventory/products`, ' +
      'same meanings. A page answers `{ ready, ids, next? }`: product ids in the partition\'s order ' +
      '(GSI4SK for catalog, GSI3SK for stock) and, when more follow, the sort key to pass back as ' +
      '`after`; a count answers `{ ready, total }`. `ready: false` until the product backfill has ' +
      'stamped the current index — the caller then reads DynamoDB. A body it cannot answer exactly ' +
      'is a 400.',
  })
  async query(@Body() body: any) {
    const { mode, query } = parseProductListInput(body);
    const data = mode === 'count' ? await this.productList.count(query) : await this.productList.page(query);
    return { success: true, data };
  }
}
