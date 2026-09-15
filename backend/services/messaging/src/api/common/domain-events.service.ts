import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService, SnsPublisherService } from '@bitcrm/shared';
import { MESSAGE_EVENT_TOPIC, MessageEventType, type ConversationUpdatedEvent } from '@bitcrm/types';

/**
 * The SNS side of "something changed" (design §7.3): `conversation.updated`
 * on the `message-events` topic, which search consumes to reindex the
 * conversation document. Fire-and-forget — a failed publish never fails the
 * write (CLAUDE.md §6). Silent when `MESSAGE_EVENTS_TOPIC_ARN` is unset, as
 * `.env.example` promises. Live UI updates do not go through here; that is
 * the realtime module's job.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  conversationUpdated(conversationId: string): void {
    const payload: ConversationUpdatedEvent = { conversationId };
    this.publish(MessageEventType.CONVERSATION_UPDATED, payload);
  }

  private publish<T>(eventType: string, payload: T): void {
    if (!this.snsPublisher || !process.env.MESSAGE_EVENTS_TOPIC_ARN) return;
    this.snsPublisher
      .publish(MESSAGE_EVENT_TOPIC, eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished?.inc({ event_type: eventType }))
      .catch((error: Error) => {
        this.businessMetrics?.eventsFailed?.inc({ event_type: eventType });
        this.logger.warn(`${eventType} publish failed: ${error?.message ?? error}`);
      });
  }
}
