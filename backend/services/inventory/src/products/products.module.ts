import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository, ProductsCacheService],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
