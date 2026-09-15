import { Module } from '@nestjs/common';
import { TwilioModule } from '../common/twilio/twilio.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { MediaQueueModule } from '../media/media-queue.module';
import { FallbackCaptureService } from './fallback-capture.service';
import { InboundReplayHandler } from './inbound-replay.handler';
import { InboundService } from './inbound.service';
import { PartyResolver } from './party-resolver';
import { PhoneDirectory } from './phone-directory';

/**
 * Everything that turns a Twilio inbound form into a stored message
 * (design §4.3). No controllers here — the webhook routes live in
 * `webhooks/`, the queue consumer in `media/`, the reconciliation in
 * `reconcile/`; all three call `InboundService`.
 */
@Module({
  imports: [TwilioModule, ConversationsModule, MessagesModule, OptOutsModule, MediaQueueModule],
  providers: [PhoneDirectory, PartyResolver, InboundService, FallbackCaptureService, InboundReplayHandler],
  exports: [InboundService, PartyResolver, FallbackCaptureService, InboundReplayHandler],
})
export class InboundModule {}
