export interface EventMessage<T = unknown> {
  eventType: string;
  timestamp: string;
  source: string;
  payload: T;
}

export interface EventHandler {
  eventType: string;
  handler: (payload: unknown) => Promise<void>;
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
