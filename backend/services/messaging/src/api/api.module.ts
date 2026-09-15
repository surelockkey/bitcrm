import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboxCountersModule } from '../counters/inbox-counters.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AccessModule } from './access/access.module';
import { DomainEventsService } from './common/domain-events.service';
import { ConversationManagementController } from './conversations/conversation-management.controller';
import { ConversationManagementService } from './conversations/conversation-management.service';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { CountersModule } from './counters/counters.module';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';

/**
 * The inbox REST surface (design §7.1) over the domain repositories.
 * `ConversationsController` is registered first: its static routes must be
 * matched before anything else under `/conversations`.
 */
@Module({
  imports: [
    ConversationsModule,
    MessagesModule,
    InboxCountersModule,
    OptOutsModule,
    AccessModule,
    CountersModule,
    RealtimeModule,
  ],
  controllers: [ConversationsController, ConversationManagementController, MessagesController],
  providers: [ConversationsService, ConversationManagementService, MessagesService, DomainEventsService],
  exports: [ConversationsService, ConversationManagementService, MessagesService, DomainEventsService],
})
export class ApiModule {}
