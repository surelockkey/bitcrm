import { Module } from '@nestjs/common';
import { MessagesRepository } from './messages.repository';
import { PendingStatusTracker } from './pending-status.tracker';

/**
 * The message repository, plus the per-process set of outbound lines still
 * waiting for a terminal status — fed by the outbound worker, walked by the
 * reconciliation poller; here so neither module has to import the other.
 */
@Module({
  providers: [MessagesRepository, PendingStatusTracker],
  exports: [MessagesRepository, PendingStatusTracker],
})
export class MessagesModule {}
