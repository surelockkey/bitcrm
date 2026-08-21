import { Module } from '@nestjs/common';
import { ContainerTemplatesController } from './container-templates.controller';
import { ContainerTemplatesService } from './container-templates.service';
import { ContainerTemplatesRepository } from './container-templates.repository';
import { ContainersModule } from '../containers/containers.module';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [ContainersModule, ProductsModule, StockModule],
  controllers: [ContainerTemplatesController],
  providers: [ContainerTemplatesService, ContainerTemplatesRepository],
  exports: [ContainerTemplatesService],
})
export class ContainerTemplatesModule {}
