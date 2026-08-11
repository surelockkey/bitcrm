import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Redis } from 'ioredis';
import { RedisService } from '@bitcrm/shared';
import { type CallRecord } from './calls.repository';

export interface CallEvent {
  type: 'call.upserted' | 'call.recording_ready';
  call: CallRecord;
}

const CHANNEL = 'telephony:call-events';

/**
 * In-process fan-out of call updates, bridged over Redis pub/sub so every
 * service instance sees every update regardless of which one handled the
 * webhook. Publishing is fire-and-forget; the subscriber connection (Redis
 * requires a dedicated connection in subscribe mode) is created lazily on the
 * first stream() and torn down with the module.
 */
@Injectable()
export class CallEventsBus implements OnModuleDestroy {
  private readonly logger = new Logger(CallEventsBus.name);
  private readonly subject = new Subject<CallEvent>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  publish(event: CallEvent): void {
    void this.redis.client
      .publish(CHANNEL, JSON.stringify(event))
      .catch((err) =>
        this.logger.warn(`publish failed: ${err instanceof Error ? err.message : err}`),
      );
  }

  stream(): Observable<CallEvent> {
    this.ensureSubscriber();
    return this.subject.asObservable();
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    this.subscriber = this.redis.client.duplicate();
    void this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        this.subject.next(JSON.parse(message) as CallEvent);
      } catch {
        this.logger.warn('dropped malformed call event');
      }
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
