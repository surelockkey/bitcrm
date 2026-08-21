import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { BrandsService } from './brands.service';
import { ProductCategoriesService } from './product-categories.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

/**
 * Brands and categories describe products, so they reuse the `products`
 * permission rather than adding resources of their own.
 */
@ApiTags('Product Catalog')
@ApiBearerAuth()
@Controller()
export class ProductCatalogController {
  constructor(
    private readonly brands: BrandsService,
    private readonly categories: ProductCategoriesService,
  ) {}

  /* ---------------------------------------------------------------- brands */

  @Get('brands')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'List brands', description: '**Guard:** `products.view` permission required.' })
  async listBrands() {
    return { success: true, data: await this.brands.findAll() };
  }

  @Post('brands')
  @RequirePermission('products', 'create')
  @ApiOperation({ summary: 'Create brand', description: '**Guard:** `products.create` permission required.' })
  async createBrand(@Body() dto: CreateBrandDto) {
    return { success: true, data: await this.brands.create(dto) };
  }

  @Put('brands/:id')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Update brand', description: '**Guard:** `products.edit` permission required.' })
  async updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return { success: true, data: await this.brands.update(id, dto) };
  }

  @Put('brands/:id/archive')
  @RequirePermission('products', 'delete')
  @ApiOperation({ summary: 'Archive brand', description: '**Guard:** `products.delete` permission required.' })
  async archiveBrand(@Param('id') id: string) {
    return { success: true, data: await this.brands.archive(id) };
  }

  @Put('brands/:id/reactivate')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Reactivate brand', description: '**Guard:** `products.edit` permission required.' })
  async reactivateBrand(@Param('id') id: string) {
    return { success: true, data: await this.brands.reactivate(id) };
  }

  /* ------------------------------------------------------------ categories */

  @Get('product-categories')
  @RequirePermission('products', 'view')
  @ApiOperation({ summary: 'List product categories with parent names', description: '**Guard:** `products.view` permission required.' })
  async listCategories() {
    return { success: true, data: await this.categories.listWithCounts() };
  }

  @Post('product-categories')
  @RequirePermission('products', 'create')
  @ApiOperation({ summary: 'Create product category', description: '**Guard:** `products.create` permission required.' })
  async createCategory(@Body() dto: CreateProductCategoryDto) {
    return { success: true, data: await this.categories.create(dto) };
  }

  @Put('product-categories/:id')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Update product category', description: '**Guard:** `products.edit` permission required.' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return { success: true, data: await this.categories.update(id, dto) };
  }

  @Put('product-categories/:id/archive')
  @RequirePermission('products', 'delete')
  @ApiOperation({ summary: 'Archive category and everything nested under it', description: '**Guard:** `products.delete` permission required.' })
  async archiveCategory(@Param('id') id: string) {
    return { success: true, data: await this.categories.archive(id) };
  }

  @Put('product-categories/:id/reactivate')
  @RequirePermission('products', 'edit')
  @ApiOperation({ summary: 'Reactivate product category', description: '**Guard:** `products.edit` permission required.' })
  async reactivateCategory(@Param('id') id: string) {
    return { success: true, data: await this.categories.reactivate(id) };
  }
}
