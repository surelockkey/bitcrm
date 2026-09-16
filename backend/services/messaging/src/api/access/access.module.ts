import { Module } from '@nestjs/common';
import { ConversationsModule } from '../../conversations/conversations.module';
import { ConversationScopeService } from './conversation-scope.service';
import { DealReadService } from './deal-read.service';
import { InternalGuard } from './internal.guard';
import { PermissionLookupService } from './permission-lookup.service';
import { UserLookupService } from './user-lookup.service';

/**
 * Who may see what: the `messages` data scope, the deal / user / permission
 * reads that back it, and the internal-secret guard. Imported by the REST
 * and realtime modules.
 */
@Module({
  imports: [ConversationsModule],
  providers: [DealReadService, UserLookupService, PermissionLookupService, ConversationScopeService, InternalGuard],
  exports: [DealReadService, UserLookupService, PermissionLookupService, ConversationScopeService, InternalGuard],
})
export class AccessModule {}
