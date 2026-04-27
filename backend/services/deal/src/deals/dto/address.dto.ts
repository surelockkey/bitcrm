import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddressDto {
  @ApiProperty({ example: '123 Main St' })
  @IsString()
  street!: string;

  @ApiPropertyOptional({ example: 'Apt 4B' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ example: 'Atlanta' })
  @IsString()
  city!: string;

  @ApiProperty({ example: 'GA' })
  @IsString()
  state!: string;

  @ApiProperty({ example: '30301' })
  @IsString()
  zip!: string;

  @ApiPropertyOptional({ example: 33.749 })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ example: -84.388 })
  @IsOptional()
  @IsNumber()
  lng?: number;
}
