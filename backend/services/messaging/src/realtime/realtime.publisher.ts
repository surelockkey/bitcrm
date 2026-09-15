import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import {
  type Conversation,
  type InboxCounters,
  type Message,
  type OptOutChannel,
  type OptOutStatus,
} from '@bitcrm/types';
import { REALTIME_CHANNEL, type MessagingRealtimeEvent } from './realtime-events';

/**
 * The one thing other modules call to push a live update to the browsers
 * (design §7.6): `publish(event)` serialises the event onto the Redis
 * channel `messaging:events`, from which every service instance's
 * `RealtimeSubscriber` feeds its SSE connections — so it does not matter
 * which instance handled the webhook or the request.
 *
 * Contract for callers (inbound webhook, outbound worker, status callback,
 * opt-out handling, management API):
 *
 *   publisher.conversationUpserted(conversation)        after any conversation write
 *   publisher.messageUpserted(message, conversation?)    after an append or a status change;
 *                                                        pass the conversation when you have it
 *   publisher.countersChanged(counters)                  after a write that moved INBOX#COUNTERS
 *                                                        (read the item back and pass it)
 *   publisher.optOutChanged({ channel, address, status, conversationId? })
 *
 * or `publish(event)` with a fully-formed `MessagingRealtimeEvent`. Publish
 * the UNMASKED entity — scope filtering and number masking happen per
 * viewer at delivery time, never here. Fire-and-forget: a Redis failure is
 * logged and never fails the write that triggered it.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);

  constructor(private readonly redis: RedisService) {}

  publish(event: MessagingRealtimeEvent): void {
    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch (err) {
      this.logger.warn(`realtime event not serialisable: ${err instanceof Error ? err.message : err}`);
      return;
    }
    void this.redis.client
      .publish(REALTIME_CHANNEL, payload)
      .catch((err) => this.logger.warn(`realtime publish failed: ${err instanceof Error ? err.message : err}`));
  }

  conversationUpserted(conversation: Conversation, at: string = new Date().toISOString()): void {
    this.publish({ type: 'conversation.upserted', at, conversation });
  }

  messageUpserted(message: Message, conversation?: Conversation, at: string = new Date().toISOString()): void {
    this.publish({ type: 'message.upserted', at, message, conversation });
  }

  countersChanged(counters: InboxCounters, at: string = new Date().toISOString()): void {
    this.publish({ type: 'counters.changed', at, counters });
  }

  optOutChanged(
    input: { channel: OptOutChannel; address: string; status: OptOutStatus; conversationId?: string },
    at: string = new Date().toISOString(),
  ): void {
    this.publish({ type: 'opt_out.changed', at, ...input });
  }
}
