import { IsEnum, IsOptional, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceAreaType } from '@bitcrm/types';
import { ZipEntryDto, GeoPointDto } from './create-service-area.dto';

/** Derive coverage for an unsaved definition — powers the map preview. */
export class PreviewServiceAreaDto {
  @ApiProperty({ enum: ServiceAreaType })
  @IsEnum(ServiceAreaType)
  type!: ServiceAreaType;

  @ApiPropertyOptional({ type: [ZipEntryDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ZipEntryDto)
  zips?: ZipEntryDto[];

  @ApiPropertyOptional({ type: [GeoPointDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  vertices?: GeoPointDto[];
}
