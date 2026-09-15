import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Redis } from 'ioredis';
import { RedisService } from '@bitcrm/shared';
import { REALTIME_CHANNEL, isRealtimeEvent, type MessagingRealtimeEvent } from './realtime-events';

/**
 * In-process fan-out of the Redis channel to every open SSE connection on
 * this instance (copy of telephony's `CallEventsBus`, read half). Redis
 * needs a dedicated connection in subscribe mode, so one is duplicated
 * lazily on the first `stream()` and closed with the module.
 */
@Injectable()
export class RealtimeSubscriber implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeSubscriber.name);
  private readonly subject = new Subject<MessagingRealtimeEvent>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  stream(): Observable<MessagingRealtimeEvent> {
    this.ensureSubscriber();
    return this.subject.asObservable();
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    this.subscriber = this.redis.client.duplicate();
    void this.subscriber
      .subscribe(REALTIME_CHANNEL)
      .catch((err) => this.logger.warn(`subscribe failed: ${err instanceof Error ? err.message : err}`));
    this.subscriber.on('message', (_channel: string, message: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        this.logger.warn('dropped malformed realtime event');
        return;
      }
      if (!isRealtimeEvent(parsed)) {
        this.logger.warn('dropped realtime event of unknown type');
        return;
      }
      this.subject.next(parsed);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.subject.complete();
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }
}
