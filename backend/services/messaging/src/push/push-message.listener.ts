import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { type Subscription } from 'rxjs';
import { RealtimeSubscriber } from '../realtime/realtime.subscriber';
import { PUSH_CONFIG, type PushConfig } from './push.config';
import { PushNotifier } from './push-notifier.service';

/**
 * Feeds `PushNotifier` the `message.upserted` frames of the realtime bus
 * (Redis `messaging:events` → `RealtimeSubscriber`, the same frames the
 * inbox streams over SSE). Every messaging task hears every frame; the
 * notifier's `PUSHSENT#message#<id>` claim lets exactly one of them push.
 * Not listening while `PUSH_ENABLED` is off; a bus that cannot be
 * subscribed to is logged and never stops the service from booting.
 */
@Injectable()
export class PushMessageListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushMessageListener.name);
  private subscription?: Subscription;

  constructor(
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
    private readonly notifier: PushNotifier,
    @Optional() private readonly subscriber?: RealtimeSubscriber,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled || !this.subscriber) return;
    try {
      this.subscription = this.subscriber.stream().subscribe((event) => {
        if (event.type === 'message.upserted') void this.notifier.onMessageUpserted(event);
      });
    } catch (error) {
      this.logger.warn(`Message push notifications are off: realtime bus unavailable (${error instanceof Error ? error.message : error})`);
    }
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}
