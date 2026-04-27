import {
  IsString, IsOptional, IsEnum, IsArray,
  ValidateNested, Matches, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DealPriority } from '@bitcrm/types';
import { AddressDto } from './address.dto';

export class UpdateDealDto {
  @ApiPropertyOptional({ example: '2026-04-22' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '14:00-17:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}-\d{2}:\d{2}$/, {
    message: 'scheduledTimeSlot must match format HH:MM-HH:MM',
  })
  scheduledTimeSlot?: string;

  @ApiPropertyOptional({ example: 'North GA' })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ example: 'rekey' })
  @IsOptional()
  @IsString()
  jobType?: string;

  @ApiPropertyOptional({ enum: DealPriority })
  @IsOptional()
  @IsEnum(DealPriority)
  priority?: DealPriority;

  @ApiPropertyOptional({ example: 'Referral' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Manager only notes' })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiPropertyOptional({ example: ['vip'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
