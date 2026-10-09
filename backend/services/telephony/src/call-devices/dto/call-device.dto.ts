import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CALL_DEVICE_LIMITS, CALL_DEVICE_TYPES, type CallDeviceType } from '@bitcrm/types';

/**
 * Telephony runs without a global ValidationPipe (CLAUDE.md §10), so these
 * decorators document the shape; the service checks it.
 */
export class CreateCallDeviceDto {
  @ApiProperty({ example: 'SURE CT LOCKSMITH' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_DEVICE_LIMITS.nameMaxLength)
  name!: string;

  @ApiPropertyOptional({ example: '(203) 989-3585', description: 'Any format; stored as E.164.' })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({ example: 'shop@sip.example.com', description: 'Rung as sip:<address>.' })
  @IsOptional()
  @IsString()
  sipAddress?: string;

  @ApiPropertyOptional({ enum: CALL_DEVICE_TYPES, default: 'desk_phone' })
  @IsOptional()
  @IsIn(CALL_DEVICE_TYPES)
  type?: CallDeviceType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Everything optional — an omitted field keeps its stored value; null clears the number / SIP address. */
export class UpdateCallDeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_DEVICE_LIMITS.nameMaxLength)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  number?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  sipAddress?: string | null;

  @ApiPropertyOptional({ enum: CALL_DEVICE_TYPES })
  @IsOptional()
  @IsIn(CALL_DEVICE_TYPES)
  type?: CallDeviceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
