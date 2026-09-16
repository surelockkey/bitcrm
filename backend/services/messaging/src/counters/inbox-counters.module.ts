import { Module } from '@nestjs/common';
import { CountersRecountController } from './counters-recount.controller';
import { CountersRecountService } from './counters-recount.service';
import { InboxCountersRepository } from './inbox-counters.repository';

@Module({
  controllers: [CountersRecountController],
  providers: [InboxCountersRepository, CountersRecountService],
  exports: [InboxCountersRepository, CountersRecountService],
})
export class InboxCountersModule {}
