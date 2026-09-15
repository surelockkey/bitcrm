import { Module } from '@nestjs/common';
import { ConversationsModule } from '../../conversations/conversations.module';
import { ConversationScopeService } from './conversation-scope.service';
import { DealReadService } from './deal-read.service';
import { InternalGuard } from './internal.guard';
import { UserLookupService } from './user-lookup.service';

/**
 * Who may see what: the `messages` data scope, the deal and user reads that
 * back it, and the internal-secret guard. Imported by the REST and realtime
 * modules.
 */
@Module({
  imports: [ConversationsModule],
  providers: [DealReadService, UserLookupService, ConversationScopeService, InternalGuard],
  exports: [DealReadService, UserLookupService, ConversationScopeService, InternalGuard],
})
export class AccessModule {}
