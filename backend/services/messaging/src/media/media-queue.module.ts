import { Module } from '@nestjs/common';
import { MediaQueueService } from './media-queue.service';

/**
 * Producer only — imported by whoever enqueues (the inbound pipeline). The
 * consumer lives in `MediaModule`, which imports this one; keeping them
 * apart avoids an `InboundModule ⇄ MediaModule` cycle.
 */
@Module({
  providers: [MediaQueueService],
  exports: [MediaQueueService],
})
export class MediaQueueModule {}
