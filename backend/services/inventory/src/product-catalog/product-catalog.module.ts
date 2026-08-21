import { Module } from '@nestjs/common';
import { ProductCatalogController } from './product-catalog.controller';
import { BrandsService } from './brands.service';
import { BrandsRepository } from './brands.repository';
import { ProductCategoriesService } from './product-categories.service';
import { ProductCategoriesRepository } from './product-categories.repository';

@Module({
  controllers: [ProductCatalogController],
  providers: [
    BrandsService,
    BrandsRepository,
    ProductCategoriesService,
    ProductCategoriesRepository,
  ],
  exports: [BrandsService, ProductCategoriesService],
})
export class ProductCatalogModule {}
