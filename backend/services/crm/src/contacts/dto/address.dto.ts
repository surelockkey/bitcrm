import { IsString, IsOptional, IsNumber, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ADDRESS_COUNTRY_PATTERN, DEFAULT_ADDRESS_COUNTRY } from '@bitcrm/types';

/** A structured postal address on a contact, matching the shared Address type. */
export class ContactAddressDto {
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

  @ApiPropertyOptional({
    example: 'CA',
    pattern: ADDRESS_COUNTRY_PATTERN.source,
    description:
      `Workiz "Country": ISO 3166-1 alpha-2, upper-cased on the way in. Absent or blank = ${DEFAULT_ADDRESS_COUNTRY}. ` +
      'CRM runs no ValidationPipe — the service checks it (contacts.service `withCountryCode`).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(ADDRESS_COUNTRY_PATTERN, { message: 'country must be an ISO 3166-1 alpha-2 code, e.g. US or CA' })
  country?: string;

  @ApiPropertyOptional({ example: 33.749 })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ example: -84.388 })
  @IsOptional()
  @IsNumber()
  lng?: number;
}
