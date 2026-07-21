import { IsString, IsOptional, IsNumber, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AddressDto } from '../../deals/dto/address.dto';

/**
 * Resolve which service area contains a location. Supply either explicit
 * coordinates or an address to geocode. If both are given, coordinates win.
 */
export class ResolveServiceAreaDto {
  @ApiPropertyOptional({ example: 33.749 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: -84.388 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
