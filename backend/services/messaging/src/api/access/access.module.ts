import { Module } from '@nestjs/common';
import { ConversationsModule } from '../../conversations/conversations.module';
import { ConversationScopeService } from './conversation-scope.service';
import { DealReadService } from './deal-read.service';
import { InternalGuard } from './internal.guard';

/**
 * Who may see what: the `messages` data scope, deal reads that back it, and
 * the internal-secret guard. Imported by the REST and realtime modules.
 */
@Module({
  imports: [ConversationsModule],
  providers: [DealReadService, ConversationScopeService, InternalGuard],
  exports: [DealReadService, ConversationScopeService, InternalGuard],
})
export class AccessModule {}
