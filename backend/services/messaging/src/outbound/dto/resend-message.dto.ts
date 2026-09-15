import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * `POST /conversations/:id/messages/:messageId/resend` — everything is
 * optional; the body may be empty. The message to resend is named by the
 * URL; `createdAt` only saves the feed lookup for its sort key.
 */
export class ResendMessageDto {
  @ApiPropertyOptional({
    description:
      'Idempotency key (uuid) — a repeated submit with the same key returns the first copy. ' +
      'When absent the service mints `resend:<messageId>:<n>` (n = previous resends + 1), so a double click sends once.',
  })
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;

  @ApiPropertyOptional({
    description: "The message's createdAt exactly as listed (part of its sort key); without it the recent feed is searched for the id.",
  })
  @IsOptional()
  @IsString()
  @IsISO8601({ strict: true })
  createdAt?: string;
}
