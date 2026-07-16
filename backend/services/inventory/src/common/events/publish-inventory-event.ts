import { Logger } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';

/** Topic key registered in EventsModule.forRoot({ publisher: { topicArns } }). */
const INVENTORY_TOPIC_KEY = 'inventory-events';

/**
 * Fire-and-forget publish to the inventory-events SNS topic (consumed by the
 * search indexer, and any future consumers). Never throws — a failed publish must
 * not fail the write; it is logged and the search backfill reconciles the index.
 * No-op when the publisher is absent (e.g. local dev without SNS configured).
 */
export function publishInventoryEvent(
  publisher: SnsPublisherService | undefined,
  logger: Logger,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  publisher
    ?.publish(INVENTORY_TOPIC_KEY, eventType, payload)
    .catch((err) =>
      logger.warn(`Failed to publish ${eventType}: ${err.message}`),
    );
}
