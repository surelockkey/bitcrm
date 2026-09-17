import { Module } from '@nestjs/common';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { ExpoPushService } from './expo-push.service';
import { PushDevicesController } from './push-devices.controller';
import { PushDevicesRepository } from './push-devices.repository';
import { PushNotifierService } from './push-notifier.service';
import { PUSH_CONFIG, loadPushConfig } from './push.config';

/**
 * Push notifications for the technician app: the device registry
 * (`POST/DELETE /devices`), the Expo transport, and the notifier that turns
 * "a job was sent" and "a message arrived" into something readable on a lock
 * screen.
 *
 * It lives in messaging-service because this service is already the
 * notification hub — it consumes `deal-events`, stores the conversations and
 * owns quiet hours and opt-outs. A push is one more channel, not a new
 * system.
 *
 * Deliberately imports only the two modules whose knowledge it needs
 * (settings for the zone and quiet hours, opt-outs for the STOP ledger), so
 * that `OutboundModule` and `AutomationsModule` can import **this** without
 * a cycle. Nothing here starts a consumer, a poller or an AWS client.
 */
@Module({
  imports: [MessagingSettingsModule, OptOutsModule],
  controllers: [PushDevicesController],
  providers: [
    { provide: PUSH_CONFIG, useFactory: loadPushConfig },
    PushDevicesRepository,
    ExpoPushService,
    PushNotifierService,
  ],
  exports: [PushNotifierService, PushDevicesRepository, ExpoPushService],
})
export class PushModule {}
