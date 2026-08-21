import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ContainerVanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  /** Bounded to keep obvious typos (year 217, 20177) out of the record. */
  @ApiPropertyOptional({ minimum: 1900, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  licensePlate?: string;
}

export class UpdateContainerDto {
  @ApiPropertyOptional({ description: 'Display name of the location, e.g. "(AZ) ELI SZENDER"' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: ContainerVanDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContainerVanDto)
  van?: ContainerVanDto;

  @ApiPropertyOptional({ description: 'Container template describing the expected loadout.' })
  @IsOptional()
  @IsString()
  templateId?: string;
}
