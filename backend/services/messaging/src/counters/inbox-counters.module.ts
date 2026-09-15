import { Module } from '@nestjs/common';
import { InboxCountersRepository } from './inbox-counters.repository';

@Module({
  providers: [InboxCountersRepository],
  exports: [InboxCountersRepository],
})
export class InboxCountersModule {}
