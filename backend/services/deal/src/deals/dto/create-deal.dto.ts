import {
  IsString, IsOptional, IsEnum, IsArray,
  IsUUID, ValidateNested, Matches, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType, DealPriority } from '@bitcrm/types';
import { AddressDto } from './address.dto';

export class CreateDealDto {
  @ApiProperty({ example: 'contact-uuid' })
  @IsUUID()
  contactId!: string;

  @ApiPropertyOptional({ example: 'company-uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ enum: ClientType, example: ClientType.RESIDENTIAL })
  @IsEnum(ClientType)
  clientType!: ClientType;

  @ApiPropertyOptional({ example: '2026-04-20' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '09:00-12:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}-\d{2}:\d{2}$/, {
    message: 'scheduledTimeSlot must match format HH:MM-HH:MM',
  })
  scheduledTimeSlot?: string;

  @ApiProperty({ example: 'Atlanta Metro' })
  @IsString()
  serviceArea!: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ example: 'lockout' })
  @IsString()
  jobType!: string;

  @ApiPropertyOptional({ enum: DealPriority, example: DealPriority.NORMAL })
  @IsOptional()
  @IsEnum(DealPriority)
  priority?: DealPriority;

  @ApiPropertyOptional({ example: 'Google Ads' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'Client locked out of home' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: ['vip', 'urgent'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
