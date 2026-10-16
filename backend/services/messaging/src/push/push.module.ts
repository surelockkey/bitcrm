import { Module } from '@nestjs/common';
import { AutomationPeersClient } from '../automations/internal/peers.client';
import { ConversationsModule } from '../conversations/conversations.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessageTemplatesModule } from '../templates/message-templates.module';
import { ExpoPushClient } from './expo-push.client';
import { PUSH_CONFIG, loadPushConfig } from './push.config';
import { PushMessageListener } from './push-message.listener';
import { PushNotifier } from './push-notifier.service';
import { PushRepository } from './push.repository';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';

/**
 * Push notifications to the technician app through the Expo push service:
 * the device registry (`PUT` / `DELETE /push-tokens`) and `PushNotifier`,
 * which `AutomationsModule`'s job-event handler feeds with job events and
 * `PushMessageListener` with the realtime bus's `message.upserted` frames.
 * `ContextLoader` (templates) reads the job as the texts need it — type,
 * number, client, the visit on the job's own clock; `AutomationPeersClient`
 * reads users.
 */
@Module({
  imports: [MessageTemplatesModule, ConversationsModule, RealtimeModule],
  controllers: [PushTokensController],
  providers: [
    { provide: PUSH_CONFIG, useFactory: () => loadPushConfig() },
    PushRepository,
    PushTokensService,
    ExpoPushClient,
    AutomationPeersClient,
    PushNotifier,
    PushMessageListener,
  ],
  exports: [PushRepository, PushNotifier],
})
export class PushModule {}
