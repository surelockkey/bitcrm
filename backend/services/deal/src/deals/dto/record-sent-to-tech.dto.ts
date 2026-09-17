import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEND_TO_TECH_CHANNELS, type SendToTechChannel } from '@bitcrm/types';

export const SENT_TO_TECH_DELIVERY_STATUSES = ['sent', 'skipped', 'failed'] as const;
export type SentToTechDeliveryStatus = (typeof SENT_TO_TECH_DELIVERY_STATUSES)[number];

/**
 * `PUT /deals/internal/:id/sent-to-tech` — messaging-service reporting what
 * happened to one (technician, channel) of a `deal.sent_to_tech` event:
 * the message it stored, or why nothing went out (`no_phone`, `opted_out`,
 * `email_not_configured`, …). Lands on the `ASSIGN#<techId>` row.
 */
export class RecordSentToTechDto {
  @ApiProperty()
  @IsString()
  techId!: string;

  @ApiProperty({ enum: SEND_TO_TECH_CHANNELS })
  @IsIn(SEND_TO_TECH_CHANNELS)
  channel!: SendToTechChannel;

  @ApiProperty({ enum: SENT_TO_TECH_DELIVERY_STATUSES })
  @IsIn(SENT_TO_TECH_DELIVERY_STATUSES)
  status!: SentToTechDeliveryStatus;

  @ApiProperty({ description: 'The `sentAt` of the click this delivery belongs to.' })
  @IsISO8601()
  sentAt!: string;

  @ApiPropertyOptional({ description: 'Why nothing went out, when `status` is not `sent`.' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'When messaging handled it; defaults to now.' })
  @IsOptional()
  @IsISO8601()
  at?: string;
}
