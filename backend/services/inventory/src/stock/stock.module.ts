import { Global, Module } from '@nestjs/common';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';

@Global()
@Module({
  providers: [StockRepository, StockService],
  exports: [StockRepository, StockService],
})
export class StockModule {}
