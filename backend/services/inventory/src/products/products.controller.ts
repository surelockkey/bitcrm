import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @RequirePermission('products', 'create')
  @ApiOperation({ summary: 'Create a product', description: '**Guard:** `products.create` permission required.' })
  async create(@Body() dto: CreateProductDto) {
    const data = await this.productsService.create(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'List products with filters', description: '**Guard:** `products.view` permission required.' })
  async list(@Query() query: ListProductsQueryDto) {
    const { items, nextCursor } = await this.productsService.list(query);
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  @Get(':id')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get product by ID', description: '**Guard:** `products.view` permission required.' })
  async findById(@Param('id') id: string) {
    const data = await this.productsService.findById(id);
    return { success: true, data };
  }

  @Get('sku/:sku')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'Get product by SKU', description: '**Guard:** `products.view` permission required.' })
  async findBySku(@Param('sku') sku: string) {
    const data = await this.productsService.findBySku(sku);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Update a product', description: '**Guard:** `products.edit` permission required.' })
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const data = await this.productsService.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('products', 'delete')
  @ApiOperation({ summary: 'Archive a product', description: '**Guard:** `products.delete` permission required.' })
  async archive(@Param('id') id: string) {
    const data = await this.productsService.archive(id);
    return { success: true, data };
  }

  @Post('import')
  @RequirePermission('products', 'create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import products from CSV', description: '**Guard:** `products.create` permission required.' })
  async importCsv(@UploadedFile() file: Express.Multer.File) {
    const data = await this.productsService.importFromCsv(file.buffer);
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
}
