import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboxCountersModule } from '../counters/inbox-counters.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { AccessModule } from './access/access.module';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { CountersService } from './counters/counters.service';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';

/**
 * The inbox REST surface (design §7.1) over the domain repositories.
 * `ConversationsController` is registered first: its static routes must be
 * matched before anything else under `/conversations`.
 */
@Module({
  imports: [ConversationsModule, MessagesModule, InboxCountersModule, OptOutsModule, AccessModule],
  controllers: [ConversationsController, MessagesController],
  providers: [ConversationsService, MessagesService, CountersService],
  exports: [ConversationsService, MessagesService, CountersService],
})
export class ApiModule {}
