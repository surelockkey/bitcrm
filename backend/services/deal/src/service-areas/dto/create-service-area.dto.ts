import {
  IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsInt,
  IsNumber, Min, Max, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceAreaType } from '@bitcrm/types';

export class ZipEntryDto {
  @ApiProperty({ example: '30301' })
  @IsString()
  zip!: string;

  @ApiPropertyOptional({ example: 10, description: 'Extra miles around the ZIP centroid.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  radiusMiles?: number;
}

export class GeoPointDto {
  @ApiProperty({ example: 33.749 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -84.388 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class CreateServiceAreaDto {
  @ApiProperty({ example: 'Atlanta Metro' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 0, description: 'Higher wins tie-breaks; also list order.' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ enum: ServiceAreaType, example: ServiceAreaType.ZIPS })
  @IsEnum(ServiceAreaType)
  type!: ServiceAreaType;

  @ApiPropertyOptional({ type: [ZipEntryDto], description: 'Required when type=zips.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ZipEntryDto)
  zips?: ZipEntryDto[];

  @ApiPropertyOptional({ type: [GeoPointDto], description: 'Required when type=polygon (>=3 points).' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  vertices?: GeoPointDto[];
}
