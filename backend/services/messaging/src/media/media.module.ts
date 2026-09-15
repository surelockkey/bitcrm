import { Inject, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { TwilioModule } from '../common/twilio/twilio.module';
import { InboundModule } from '../inbound/inbound.module';
import { InboundReplayHandler } from '../inbound/inbound-replay.handler';
import { MessagesModule } from '../messages/messages.module';
import { MediaQueueModule } from './media-queue.module';
import { INBOUND_REPLAY_JOB, MEDIA_COPY_JOB, type InboundReplayJob, type MediaCopyJob } from './media.jobs';
import { MediaService } from './media.service';

/** The `messaging-media` queue consumer — `undefined` when the queue URL is not configured. */
export const MEDIA_QUEUE_CONSUMER = Symbol('MEDIA_QUEUE_CONSUMER');

/** Set by the module init so tests can call it without booting Nest. */
export function registerMediaQueueHandlers(
  consumer: Pick<SqsConsumerService, 'registerHandler'>,
  media: Pick<MediaService, 'copy'>,
  replay: Pick<InboundReplayHandler, 'handle'>,
): void {
  consumer.registerHandler(MEDIA_COPY_JOB, async (payload) => {
    await media.copy(payload as MediaCopyJob);
  });
  consumer.registerHandler(INBOUND_REPLAY_JOB, (payload) => replay.handle(payload as InboundReplayJob));
}

/**
 * Consumer side of the service's own work queue (`MESSAGING_MEDIA_QUEUE_URL`):
 * `messaging.media.copy` (§4.6) and `messaging.inbound.replay` (§4.3). A
 * second `SqsConsumerService` next to the contact-events one `AppModule`
 * owns — the shared consumer is one queue per instance. Same gating as every
 * consumer in the platform: constructed only when the URL is set, polling
 * only under `ENABLE_SQS_CONSUMER=true`. Failed handlers leave the message
 * on the queue; the queue's redrive policy parks it on the DLQ after 5
 * receives (`infra/dev/data_plane.tf`).
 */
@Module({
  imports: [TwilioModule, MessagesModule, InboundModule, MediaQueueModule],
  providers: [
    MediaService,
    {
      provide: MEDIA_QUEUE_CONSUMER,
      useFactory: () => {
        const queueUrl = process.env.MESSAGING_MEDIA_QUEUE_URL;
        if (!queueUrl) return undefined;
        return new SqsConsumerService({
          region: process.env.AWS_REGION || 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT,
          queueUrl,
          waitTimeSeconds: 20,
          // Each job may download several files; keep a batch small.
          maxMessages: 5,
        });
      },
    },
  ],
  exports: [MediaService],
})
export class MediaModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly media: MediaService,
    private readonly replay: InboundReplayHandler,
    @Optional() @Inject(MEDIA_QUEUE_CONSUMER) private readonly consumer?: SqsConsumerService,
  ) {}

  onModuleInit() {
    if (!this.consumer) return;
    registerMediaQueueHandlers(this.consumer, this.media, this.replay);
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.consumer.start();
    }
  }

  onModuleDestroy() {
    this.consumer?.stop();
  }
}
