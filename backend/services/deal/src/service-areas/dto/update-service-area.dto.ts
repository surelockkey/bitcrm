import {
  IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsInt,
  ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceAreaType } from '@bitcrm/types';
import { ZipEntryDto, GeoPointDto } from './create-service-area.dto';

/**
 * All fields optional. Geometry (`coverage`) is only recomputed when `type`
 * plus its matching `zips`/`vertices` are supplied; otherwise the stored
 * geometry is kept and only metadata (name/priority/active) changes.
 */
export class UpdateServiceAreaDto {
  @ApiPropertyOptional({ example: 'Atlanta Metro' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: ServiceAreaType })
  @IsOptional()
  @IsEnum(ServiceAreaType)
  type?: ServiceAreaType;

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
