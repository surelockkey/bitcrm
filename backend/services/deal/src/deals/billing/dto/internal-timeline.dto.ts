import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TimelineEventType } from '@bitcrm/types';

export class InternalTimelineDto {
  @ApiProperty({ enum: TimelineEventType, example: TimelineEventType.INVOICE_CREATED })
  @IsEnum(TimelineEventType)
  type!: TimelineEventType;

  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  actorId!: string;

  @ApiPropertyOptional({ example: 'jane@acme.com', description: 'Display label; defaults to "Billing".' })
  @IsOptional()
  @IsString()
  actorName?: string;

  @ApiPropertyOptional({ example: { invoiceNumber: 'AB12CD', total: 120 }, description: 'Stored as the entry `details`.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
