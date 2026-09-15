import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OPT_OUT_CHANNELS,
  OPT_OUT_SOURCES,
  OPT_OUT_STATUSES,
  type OptOutChannel,
  type OptOutSource,
  type OptOutStatus,
} from '@bitcrm/types';

/** `GET /opt-outs?address=` — one address, both channels looked up. */
export class LookupOptOutsQueryDto {
  @ApiProperty({ example: '+14045551234', description: 'A phone (any dialable form) or an email.' })
  @IsString()
  @Length(3, 254)
  address!: string;
}

/** `PUT /opt-outs/:channel/:address` — a manual STOP or START by an admin. */
export class SetOptOutDto {
  @ApiProperty({ enum: OPT_OUT_STATUSES, example: 'opted_out' })
  @IsIn(OPT_OUT_STATUSES)
  status!: OptOutStatus;

  @ApiPropertyOptional({ example: 'STOP', description: 'Keyword the client used, when this records one.' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  keyword?: string;
}

export class ImportOptOutItemDto {
  @ApiProperty({ example: '+14045551234', description: 'Phone in any dialable form (normalised to E.164) or an email.' })
  @IsString()
  @Length(3, 254)
  address!: string;

  @ApiProperty({ enum: OPT_OUT_CHANNELS, example: 'sms' })
  @IsIn(OPT_OUT_CHANNELS)
  channel!: OptOutChannel;

  @ApiPropertyOptional({ enum: OPT_OUT_STATUSES, default: 'opted_out' })
  @IsOptional()
  @IsIn(OPT_OUT_STATUSES)
  status?: OptOutStatus;

  @ApiPropertyOptional({ enum: OPT_OUT_SOURCES, default: 'workiz_import' })
  @IsOptional()
  @IsIn(OPT_OUT_SOURCES)
  source?: OptOutSource;

  @ApiPropertyOptional({ example: 'STOP' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  keyword?: string;

  @ApiPropertyOptional({ example: '2026-08-01T14:03:00.000Z', description: 'When the client opted out (ISO 8601); now if omitted.' })
  @IsOptional()
  @IsISO8601()
  at?: string;
}

/**
 * `POST /opt-outs/import` — the ~3.9k Workiz STOP addresses before go-live
 * (design §4.7), in batches of up to 1 000.
 */
export class ImportOptOutsDto {
  @ApiProperty({ type: [ImportOptOutItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportOptOutItemDto)
  items!: ImportOptOutItemDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Replace rows that already exist. Off by default so a re-run never clobbers a START the client sent since.',
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}
