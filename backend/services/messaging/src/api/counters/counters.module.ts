import { Module } from '@nestjs/common';
import { InboxCountersModule } from '../../counters/inbox-counters.module';
import { AccessModule } from '../access/access.module';
import { CountersService } from './counters.service';

/** The scoped badge counters — shared by the REST module and the realtime stream. */
@Module({
  imports: [InboxCountersModule, AccessModule],
  providers: [CountersService],
  exports: [CountersService],
})
export class CountersModule {}
