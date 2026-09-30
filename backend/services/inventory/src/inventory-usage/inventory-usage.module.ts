import { Global, Module } from '@nestjs/common';
import { InventoryUsageInternalController } from './inventory-usage-internal.controller';
import { InventoryUsageService } from './inventory-usage.service';
import { InventoryUsageRepository } from './inventory-usage.repository';

/**
 * Global, like the inventory log: the stock moves keep the usage projection
 * and should not import a module for it; the report module reads it through
 * the exported repository. The projection never depends on them back.
 */
@Global()
@Module({
  controllers: [InventoryUsageInternalController],
  providers: [InventoryUsageService, InventoryUsageRepository],
  exports: [InventoryUsageService, InventoryUsageRepository],
})
export class InventoryUsageModule {}
