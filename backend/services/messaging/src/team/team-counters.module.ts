import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { TeamCountersService } from './team-counters.service';

/**
 * Per-member read state of staff threads (design §6). Its own module, with
 * no dependency on the rest of the team API, so the realtime stream can
 * recount a member's badge without a cycle (`TeamModule` → `RealtimeModule`
 * → here).
 */
@Module({
  imports: [ConversationsModule],
  providers: [TeamCountersService],
  exports: [TeamCountersService],
})
export class TeamCountersModule {}
