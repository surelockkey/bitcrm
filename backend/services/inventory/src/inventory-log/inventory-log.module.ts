import { Global, Module } from '@nestjs/common';
import { InventoryLogController } from './inventory-log.controller';
import { InventoryLogService } from './inventory-log.service';
import { InventoryLogRepository } from './inventory-log.repository';

/**
 * Global: products and transfers both write the log, and neither should
 * import a module for it. The log never depends on them back.
 */
@Global()
@Module({
  controllers: [InventoryLogController],
  providers: [InventoryLogService, InventoryLogRepository],
  exports: [InventoryLogService],
})
export class InventoryLogModule {}
