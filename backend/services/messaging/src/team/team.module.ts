import { Module } from '@nestjs/common';
import { AccessModule } from '../api/access/access.module';
import { DomainEventsService } from '../api/common/domain-events.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboxCountersModule } from '../counters/inbox-counters.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { TeamAccessService } from './team-access.service';
import { TeamController } from './team.controller';
import { TeamConversationsService } from './team-conversations.service';
import { TeamCountersModule } from './team-counters.module';

/**
 * Staff chat (design §6, M16): employee threads, groups, per-member read
 * state. Feeds and sending stay in the inbox API and the outbound module;
 * `POST /conversations` (find-or-create for any party) lives in the API
 * module and calls `TeamConversationsService` for user parties.
 */
@Module({
  imports: [ConversationsModule, InboxCountersModule, AccessModule, RealtimeModule, TeamCountersModule],
  controllers: [TeamController, GroupsController],
  providers: [TeamAccessService, TeamConversationsService, GroupsService, DomainEventsService],
  exports: [TeamAccessService, TeamConversationsService, GroupsService],
})
export class TeamModule {}
