import { Module } from '@nestjs/common';
import { TwilioModule } from '../common/twilio/twilio.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { CrmContactsClient } from './internal/crm-contacts.client';
import { DealContextClient } from './internal/deal-context.client';
import { TelephonyNumbersClient } from './internal/telephony-numbers.client';
import { OUTBOUND_CONFIG, loadOutboundConfig } from './outbound.config';
import { OutboundEventsPublisher } from './outbound-events';
import { OutboundQueueProducer } from './outbound-queue.producer';
import { SendController } from './send.controller';
import { SendService } from './send.service';
import { SenderResolver } from './sender.resolver';

/**
 * Outbound SMS/MMS (design §4.4, M9): the send API, sender selection and
 * the FIFO queue producer. The worker, the Twilio status callback and the
 * attachment presign land in the same module as the next steps.
 */
@Module({
  imports: [TwilioModule, ConversationsModule, MessagesModule, OptOutsModule, MessagingSettingsModule],
  controllers: [SendController],
  providers: [
    { provide: OUTBOUND_CONFIG, useFactory: loadOutboundConfig },
    TelephonyNumbersClient,
    DealContextClient,
    CrmContactsClient,
    SenderResolver,
    OutboundQueueProducer,
    OutboundEventsPublisher,
    SendService,
  ],
  exports: [SendService, SenderResolver, OutboundQueueProducer, OUTBOUND_CONFIG],
})
export class OutboundModule {}
