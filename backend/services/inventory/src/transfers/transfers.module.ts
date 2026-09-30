import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TransfersRepository } from './transfers.repository';
import { ProductsModule } from '../products/products.module';

@Module({
  // The container a technician works from comes from the global
  // UserContainersModule; locations and stock from the global StockModule.
  imports: [ProductsModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransfersRepository],
  exports: [TransfersService, TransfersRepository],
})
export class TransfersModule {}
