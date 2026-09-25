import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Redis } from 'ioredis';
import { RedisService } from '@bitcrm/shared';

/**
 * "Something about this deal changed — refetch what shows it." Carries the
 * id only: every viewer rereads through the scoped list and detail routes,
 * so the frame itself needs no per-viewer filtering or masking.
 */
export interface DealEvent {
  type: 'deal.changed';
  dealId: string;
  at: string;
}

export const DEAL_EVENTS_CHANNEL = 'deal:events';

function isDealEvent(value: unknown): value is DealEvent {
  const e = value as Partial<DealEvent> | null;
  return !!e && e.type === 'deal.changed' && typeof e.dealId === 'string';
}

/**
 * In-process fan-out of deal changes, bridged over Redis pub/sub so every
 * service instance sees every write regardless of which one handled it
 * (copy of telephony's `CallEventsBus`). Publishing is fire-and-forget; the
 * subscriber connection (Redis needs a dedicated one in subscribe mode) is
 * created lazily on the first `stream()` and torn down with the module.
 */
@Injectable()
export class DealEventsBus implements OnModuleDestroy {
  private readonly logger = new Logger(DealEventsBus.name);
  private readonly subject = new Subject<DealEvent>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  dealChanged(dealId: string, at: string = new Date().toISOString()): void {
    const event: DealEvent = { type: 'deal.changed', dealId, at };
    void this.redis.client
      .publish(DEAL_EVENTS_CHANNEL, JSON.stringify(event))
      .catch((err) => this.logger.warn(`publish failed: ${err instanceof Error ? err.message : err}`));
  }

  stream(): Observable<DealEvent> {
    this.ensureSubscriber();
    return this.subject.asObservable();
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    this.subscriber = this.redis.client.duplicate();
    void this.subscriber
      .subscribe(DEAL_EVENTS_CHANNEL)
      .catch((err) => this.logger.warn(`subscribe failed: ${err instanceof Error ? err.message : err}`));
    this.subscriber.on('message', (_channel: string, message: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        this.logger.warn('dropped malformed deal event');
        return;
      }
      if (!isDealEvent(parsed)) {
        this.logger.warn('dropped deal event of unknown type');
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
