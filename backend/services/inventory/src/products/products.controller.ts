import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, hasPermission } from '@bitcrm/shared';
import { type JwtUser, type Product } from '@bitcrm/types';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { coerceInternalLimit } from '../common/utils/internal-pagination';

/**
 * The owner's money rule: a product answer carries the company cost
 * (`costCompany`) only for a caller with `financials.view` (the Super Admin
 * always). `costTech` stays — technicians see their own cost. The internal
 * routes serve other services and keep everything.
 */
function forCaller<T extends Product>(product: T, req: any): T {
  if (hasPermission(req?.resolvedPermissions, 'financials', 'view')) return product;
  const { costCompany: _costCompany, ...rest } = product;
  return rest as T;
}

const MONEY_NOTE = ' `costCompany` is left out without `financials.view`.';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @RequirePermission('products', 'create')
  @ApiOperation({ summary: 'Create a product', description: '**Guard:** `products.create` permission required.' + MONEY_NOTE })
  async create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.productsService.create(dto, user);
    return { success: true, data: forCaller(data, req) };
  }

  @Get()
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'List products with filters',
    description:
      '**Guard:** `products.view` permission required. Filters combine: `category` picks the ' +
      'CategoryIndex, else `manageStock=true` reads the stock-managed partition (name order), ' +
      'else the Price Book partition — every item, products and services, active and archived, ' +
      'in name order; the other filters (`type`, `status`, `search`, `brandId`, `manageStock`) ' +
      'apply on top. On both name-ordered partitions a filtered page is filled across the whole ' +
      'partition, never an empty page with a cursor. A cursor is only good for the partition that ' +
      'handed it out; any other is a 400.' + MONEY_NOTE,
  })
  async list(@Query() query: ListProductsQueryDto, @Req() req: any) {
    const { items, nextCursor } = await this.productsService.list(query);
    return {
      success: true,
      data: items.map((item) => forCaller(item, req)),
      pagination: { nextCursor, count: items.length },
    };
  }

  // Before `:id`, or the parameter route swallows it.
  @Get('count')
  @RequirePermission('products', 'view')
  @ApiOperation({
    summary: 'How many products the list holds',
    description:
      '**Guard:** `products.view` permission required. Takes the same filters as the list ' +
      '(`category`, `type`, `status`, `search`, `brandId`, `manageStock`; `cursor` and `limit` ' +
      'are ignored) and answers ' +
      '`{ total, atLeast }` — the row count behind "Page 2 of 7", read off the same partition ' +
      'the list reads. `atLeast` means the walk ' +
      'stopped on a ceiling and the real number is higher, which the panel renders as `7+`. ' +
      'Cached for thirty seconds.',
  })
  async count(@Query() query: ListProductsQueryDto) {
    const data = await this.productsService.count(query);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get product by ID', description: '**Guard:** `products.view` permission required.' + MONEY_NOTE })
  async findById(@Param('id') id: string, @Req() req: any) {
    const data = await this.productsService.findById(id);
    return { success: true, data: forCaller(data, req) };
  }

  @Get('sku/:sku')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get product by SKU', description: '**Guard:** `products.view` permission required.' + MONEY_NOTE })
  async findBySku(@Param('sku') sku: string, @Req() req: any) {
    const data = await this.productsService.findBySku(sku);
    return { success: true, data: forCaller(data, req) };
  }

  @Get('barcode/:code')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get product by barcode', description: '**Guard:** `products.view` permission required.' + MONEY_NOTE })
  async findByBarcode(@Param('code') code: string, @Req() req: any) {
    const data = await this.productsService.findByBarcode(code);
    return { success: true, data: forCaller(data, req) };
  }

  @Put(':id')
  @RequirePermission('products', 'edit')
  @ApiOperation({
    summary: 'Update a product',
    description:
      '**Guard:** `products.edit` permission required. Partial: only the fields sent are ' +
      'validated and written. An optional field (`brandId`, `reorderLevel`, `supplier`, ' +
      '`barcode`, `description`, `taxable`, `manageStock`, `availableInBooking`, ' +
      '`bookingPrice`, `priceBookEnabled`) sent as `null` is cleared; a ' +
      'required one (`name`, `category`, `type`, the prices, …) refuses `null` with a 400. A ' +
      'field left out is kept, so a caller who never sees `costCompany` never clears it. ' +
      '`customAttributes` is a patch keyed by custom field name (`GET /item-attributes`): ' +
      'each name sent is set, `null` or "" clears it, the item\'s other values are kept; a ' +
      'name not in the catalog is a 400.' + MONEY_NOTE,
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtUser,
    @Req() req: any,
  ) {
    const data = await this.productsService.update(id, dto, user);
    return { success: true, data: forCaller(data, req) };
  }

  @Delete(':id')
  @RequirePermission('products', 'delete')
  @ApiOperation({ summary: 'Archive a product', description: '**Guard:** `products.delete` permission required.' + MONEY_NOTE })
  async archive(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.productsService.archive(id, user);
    return { success: true, data: forCaller(data, req) };
  }

  @Post(':id/reactivate')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Restore an archived product', description: '**Guard:** `products.edit` permission required.' + MONEY_NOTE })
  async reactivate(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: any) {
    const data = await this.productsService.reactivate(id, user);
    return { success: true, data: forCaller(data, req) };
  }

  @Post('import')
  @RequirePermission('products', 'create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import products from CSV', description: '**Guard:** `products.create` permission required. Pass `?dryRun=1` to validate without writing.' })
  async importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const data = await this.productsService.importFromCsv(
      file.buffer,
      dryRun === '1' || dryRun === 'true',
      user,
    );
    return { success: true, data };
  }

  @Post(':id/photo/upload-url')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Get presigned URL for photo upload', description: '**Guard:** `products.edit` permission required.' })
  async getPhotoUploadUrl(
    @Param('id') id: string,
    @Body('contentType') contentType: string,
  ) {
    const data = await this.productsService.getPhotoUploadUrl(
      id,
      contentType || 'image/jpeg',
    );
    return { success: true, data };
  }

  @Get(':id/photo')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get presigned URL for photo download', description: '**Guard:** `products.view` permission required.' })
  async getPhotoDownloadUrl(@Param('id') id: string) {
    const data = await this.productsService.getPhotoDownloadUrl(id);
    return { success: true, data };
  }

  @Get('internal/all')
  @Internal()
  @ApiOperation({ summary: 'Internal: list all products (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async listAllInternal(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const data = await this.productsService.findAll(
      coerceInternalLimit(limit),
      cursor,
    );
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({ summary: 'Internal: get product by ID (for search indexer)', description: '**Guard:** Internal (X-Internal-Secret header required). Service-to-service only.' })
  async findByIdInternal(@Param('id') id: string) {
    const data = await this.productsService.findById(id);
    if (!data) {
      throw new NotFoundException(`Product "${id}" not found`);
    }
    return { success: true, data };
  }
}
