import { Injectable, Logger } from '@nestjs/common';
import { type InboundReplayJob } from '../media/media.jobs';
import { InboundService } from './inbound.service';
import { MalformedInboundPayloadError, parseInboundPayload } from './twilio-inbound.payload';

/**
 * Consumer of `messaging.inbound.replay` jobs: the payload the fallback
 * webhook captured goes through the same pipeline as a live webhook, minus
 * the signature (it was checked when captured). A malformed payload is
 * logged and dropped — retrying cannot fix it; anything else throws so SQS
 * redelivers and eventually parks it on the DLQ.
 */
@Injectable()
export class InboundReplayHandler {
  private readonly logger = new Logger(InboundReplayHandler.name);

  constructor(private readonly inbound: InboundService) {}

  async handle(job: InboundReplayJob): Promise<void> {
    let input;
    try {
      input = parseInboundPayload(job?.payload);
    } catch (error) {
      if (error instanceof MalformedInboundPayloadError) {
        this.logger.error(`Dropping fallback capture ${job?.s3Key ?? '(no s3 key)'}: ${error.reason}`);
        return;
      }
      throw error;
    }
    const result = await this.inbound.ingest(input, { source: 'fallback' });
    this.logger.log(`Replayed ${input.providerSid}: ${result.outcome} in ${result.conversationId}`);
  }
}
