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

  @ApiPropertyOptional({
    example: 'Atlanta Metro',
    description: 'Optional label override; normally auto-resolved from the address.',
  })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({
    example: 'e1b9c2a4-5d3f-4a71-9c8e-2f6d1b0a7e34',
    description: 'Catalog job-type id (GET /api/deals/job-types). Must be an active type.',
  })
  @IsString()
  jobTypeId!: string;

  @ApiPropertyOptional({ enum: DealPriority, example: DealPriority.NORMAL })
  @IsOptional()
  @IsEnum(DealPriority)
  priority?: DealPriority;

  @ApiPropertyOptional({
    example: 'a3f2c1b4-8e7d-4a91-9c2e-1f6d0b5a7e34',
    description: 'Catalog job-source id (GET /api/deals/job-sources). Must be active.',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ example: 'wo-uuid', description: 'Platinum client Work Order this deal was authorized by.' })
  @IsOptional()
  @IsString()
  workOrderId?: string;

  @ApiPropertyOptional({ example: 'PO-12345', description: 'Client PO number.' })
  @IsOptional()
  @IsString()
  poNumber?: string;

  @ApiPropertyOptional({ example: 'Client locked out of home' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: ['t1', 't2'], description: 'Catalog job-tag ids. Must be active.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
}
