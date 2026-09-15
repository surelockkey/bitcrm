import { Module } from '@nestjs/common';
import { TwilioModule } from '../common/twilio/twilio.module';
import { InboundModule } from '../inbound/inbound.module';
import { MediaQueueModule } from '../media/media-queue.module';
import { MessagesModule } from '../messages/messages.module';
import { ReconcileController } from './reconcile.controller';
import { ReconcileService } from './reconcile.service';

/** Twilio message-log reconciliation (design M8): the service and its internal trigger. */
@Module({
  imports: [TwilioModule, InboundModule, MessagesModule, MediaQueueModule],
  controllers: [ReconcileController],
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}
