import { Global, Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { LocationsRepository } from './locations.repository';
import { ProductStockService } from './product-stock.service';
import { StockController } from './stock.controller';

@Global()
@Module({
  // The product stock view checks the product exists; ProductsModule never
  // imports this module back (global modules are not imported explicitly).
  imports: [ProductsModule],
  controllers: [StockController],
  providers: [StockRepository, StockService, LocationsRepository, ProductStockService],
  exports: [StockRepository, StockService, LocationsRepository],
})
export class StockModule {}
