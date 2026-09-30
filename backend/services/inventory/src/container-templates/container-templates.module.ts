import { Module } from '@nestjs/common';
import { ContainerTemplatesController } from './container-templates.controller';
import { ContainerTemplatesService } from './container-templates.service';
import { ContainerTemplatesRepository } from './container-templates.repository';
import { ProductsModule } from '../products/products.module';
import { TransfersModule } from '../transfers/transfers.module';

/**
 * Locations and stock come from the global StockModule. ContainersModule
 * validates `templateId` with its own ContainerTemplatesRepository provider
 * rather than importing this module, which imports TransfersModule.
 */
@Module({
  imports: [ProductsModule, TransfersModule],
  controllers: [ContainerTemplatesController],
  providers: [ContainerTemplatesService, ContainerTemplatesRepository],
  exports: [ContainerTemplatesService, ContainerTemplatesRepository],
})
export class ContainerTemplatesModule {}
