/**
 * Jobs on the service's own `messaging-media` SQS queue
 * (`MESSAGING_MEDIA_QUEUE_URL`). Bodies follow the `EventMessage` envelope
 * (`{ eventType, timestamp, source, payload }`) so the shared
 * `SqsConsumerService` dispatches them like SNS-fed events. Handlers are
 * idempotent — SQS may deliver twice (design §7.3).
 */

/** Copy one inbound message's MMS media from Twilio into S3 (§4.6). */
export const MEDIA_COPY_JOB = 'messaging.media.copy';

/** Re-run the inbound pipeline on a payload the fallback webhook captured (§4.3). */
export const INBOUND_REPLAY_JOB = 'messaging.inbound.replay';

export interface MediaCopyAttachment {
  /** `attachments[i].id` on the message. */
  id: string;
  /** Twilio `MediaUrl{N}` — needs HTTP Basic auth with the account credentials. */
  sourceUrl: string;
  contentType: string;
  /** `ME…` parsed from the URL, for the optional delete-from-Twilio step. */
  providerMediaSid?: string;
}

export interface MediaCopyJob {
  conversationId: string;
  messageId: string;
  /** Message `createdAt` — part of the sort key. */
  createdAt: string;
  /** `MessageSid` (`MM…`) the media belongs to. */
  providerSid: string;
  attachments: MediaCopyAttachment[];
}

export interface InboundReplayJob {
  /** Where the raw form was archived (`messaging/inbound-raw/<day>/<sid>.json`), when S3 was reachable. */
  s3Key?: string;
  /** The webhook form exactly as Twilio posted it to the fallback URL. */
  payload: Record<string, unknown>;
  capturedAt: string;
}
