import {
  IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsInt,
  IsNumber, Min, Max, ValidateNested, ArrayMinSize, MinLength, MaxLength,
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

/** Name 1–60 chars, rate 0–100 with at most 3 decimals (re-checked in the service). */
export class ServiceAreaTaxDto {
  @ApiProperty({ example: 'CT Sales Tax', minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 6.35, minimum: 0, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  ratePercent!: number;
}

export class CreateServiceAreaDto {
  @ApiPropertyOptional({
    example: '+14045550100',
    description:
      'Number clients in this market are dialled from. Must be a workspace ' +
      'number. Send an empty string or null to clear it.',
  })
  @IsOptional()
  @IsString()
  callerId?: string | null;

  @ApiPropertyOptional({
    type: () => ServiceAreaTaxDto,
    nullable: true,
    description:
      "The area's sales tax, applied automatically to jobs in this area. " +
      'Null clears it (jobs in the area then carry no tax).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceAreaTaxDto)
  tax?: ServiceAreaTaxDto | null;

  @ApiPropertyOptional({
    example: 'bp-default',
    nullable: true,
    description:
      'Company (billing business profile) new jobs in this area default to. ' +
      'Must be an active company. Null or empty clears it.',
  })
  @IsOptional()
  @IsString()
  defaultBusinessProfileId?: string | null;

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

  @ApiPropertyOptional({
    example: 'America/New_York',
    description: 'IANA timezone for this area’s jobs. Defaults to America/New_York.',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

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
