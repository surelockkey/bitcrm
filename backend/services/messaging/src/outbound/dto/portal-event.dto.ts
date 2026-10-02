import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PORTAL_EVENT_KINDS, type PortalEventKind, type PortalEventRequest } from '@bitcrm/types';

export class PortalEventDocumentDto {
  @ApiProperty({ enum: ['invoice', 'estimate'] })
  @IsIn(['invoice', 'estimate'])
  kind!: 'invoice' | 'estimate';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'O8E9NQ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  number!: string;
}

/** What the client did on the portal (billing → messaging). */
export class PortalEventDto implements PortalEventRequest {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @ApiProperty({ enum: PORTAL_EVENT_KINDS })
  @IsIn([...PORTAL_EVENT_KINDS])
  event!: PortalEventKind;

  @ApiProperty({ type: PortalEventDocumentDto })
  @ValidateNested()
  @Type(() => PortalEventDocumentDto)
  document!: PortalEventDocumentDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional({ description: 'The name typed under a signature; CRM names the client otherwise.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorName?: string;

  @ApiPropertyOptional({ example: 120.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ example: 'signed:invoice:inv1', description: 'One line per key.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  eventKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}
