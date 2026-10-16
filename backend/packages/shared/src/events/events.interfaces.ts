export interface EventMessage<T = unknown> {
  eventType: string;
  timestamp: string;
  source: string;
  payload: T;
}

/**
 * What the consumer knows about one delivery besides its payload. Payloads
 * carry no id of their own, so a handler that must act once per event (a
 * push notification, a text) keys its idempotency on `eventId`.
 */
export interface EventDeliveryMeta {
  /**
   * Stable across SQS redeliveries: the SNS `MessageId` when the body is an
   * SNS envelope, else the SQS `MessageId` (raw delivery — what Terraform
   * configures). Absent only if SQS sent neither.
   */
  eventId?: string;
  eventType: string;
  /** The publisher's `timestamp`. */
  timestamp?: string;
  source?: string;
}

/** A handler may ignore the meta — every consumer written before it existed does. */
export type EventPayloadHandler = (payload: unknown, meta?: EventDeliveryMeta) => Promise<void>;

export interface EventHandler {
  eventType: string;
  handler: EventPayloadHandler;
}

export interface EventsModuleOptions {
  region?: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export interface PublisherOptions extends EventsModuleOptions {
  topicArns?: Record<string, string>;
}

export interface ConsumerOptions extends EventsModuleOptions {
  queueUrl: string;
  waitTimeSeconds?: number;
  maxMessages?: number;
}

export const EVENTS_PUBLISHER_OPTIONS = 'EVENTS_PUBLISHER_OPTIONS';
export const EVENTS_CONSUMER_OPTIONS = 'EVENTS_CONSUMER_OPTIONS';
export const EVENT_HANDLERS = 'EVENT_HANDLERS';
