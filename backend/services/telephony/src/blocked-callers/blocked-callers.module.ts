import { Module } from '@nestjs/common';
import { BlockedCallersController } from './blocked-callers.controller';
import { BlockedCallersService } from './blocked-callers.service';
import { BlockedCallersRepository } from './blocked-callers.repository';

/** Workiz Phone → Blocked callers; the service is what the inbound webhook asks. */
@Module({
  controllers: [BlockedCallersController],
  providers: [BlockedCallersService, BlockedCallersRepository],
  exports: [BlockedCallersService],
})
export class BlockedCallersModule {}
