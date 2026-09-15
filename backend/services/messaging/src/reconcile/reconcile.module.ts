import { Module } from '@nestjs/common';
import { TwilioModule } from '../common/twilio/twilio.module';
import { InboundModule } from '../inbound/inbound.module';
import { MediaQueueModule } from '../media/media-queue.module';
import { MessagesModule } from '../messages/messages.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReconcileController } from './reconcile.controller';
import { RECONCILE_CONFIG, loadReconcileConfig } from './reconcile.config';
import { ReconcileService } from './reconcile.service';
import { StatusSyncPoller } from './status-sync.poller';

/**
 * Twilio message-log reconciliation (design M8): the service, its internal
 * triggers, and the opt-in status-sync poller (`MESSAGING_STATUS_SYNC_INTERVAL_SECONDS`)
 * that follows up on the lines this process sent when status callbacks
 * cannot reach it. `RealtimeModule` for the same `message.upserted` the
 * callback pushes; `PendingStatusTracker` comes with `MessagesModule`.
 */
@Module({
  imports: [TwilioModule, InboundModule, MessagesModule, MediaQueueModule, RealtimeModule],
  controllers: [ReconcileController],
  providers: [{ provide: RECONCILE_CONFIG, useFactory: loadReconcileConfig }, ReconcileService, StatusSyncPoller],
  exports: [ReconcileService, RECONCILE_CONFIG],
})
export class ReconcileModule {}
