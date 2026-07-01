import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class HomeAddressDto {
  @ApiPropertyOptional({ example: '123 Main St' })
  @IsString()
  @MinLength(1)
  line1!: string;

  @ApiPropertyOptional({ example: 'Apt 4' })
  @IsOptional()
  @IsString()
  line2?: string;

  @ApiPropertyOptional({ example: 'Atlanta' })
  @IsString()
  @MinLength(1)
  city!: string;

  @ApiPropertyOptional({ example: 'GA' })
  @IsString()
  @MinLength(1)
  state!: string;

  @ApiPropertyOptional({ example: '30301' })
  @IsString()
  @MinLength(1)
  zip!: string;

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
}

/** Self-fill profile fields. A technician may edit these on their own profile. */
export class UpdateTechnicianProfileDto {
  @ApiPropertyOptional({ example: '404-555-0123' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  phone?: string;

  @ApiPropertyOptional({ type: HomeAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HomeAddressDto)
  homeAddress?: HomeAddressDto;

  @ApiPropertyOptional({ example: 'https://files/photo.jpg' })
  @IsOptional()
  @IsString()
  profilePhotoUrl?: string;
}
