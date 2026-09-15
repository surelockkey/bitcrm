import { Module } from '@nestjs/common';
import { AccessModule } from '../api/access/access.module';
import { CountersModule } from '../api/counters/counters.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { TeamCountersModule } from '../team/team-counters.module';
import { RealtimeController } from './realtime.controller';
import { RealtimeFilterService } from './realtime-filter.service';
import { RealtimePublisher } from './realtime.publisher';
import { RealtimeSubscriber } from './realtime.subscriber';

/**
 * Redis pub/sub → SSE (design §7.6). Exports `RealtimePublisher`, the one
 * entry point other modules use to push a live update; everything else here
 * is the delivery side. `TeamCountersModule` (not the whole team module,
 * which imports this one) recounts a member's team-chat badge (§6).
 */
@Module({
  imports: [AccessModule, CountersModule, ConversationsModule, TeamCountersModule],
  controllers: [RealtimeController],
  providers: [RealtimePublisher, RealtimeSubscriber, RealtimeFilterService],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
