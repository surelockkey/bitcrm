import {
  IsString, IsOptional, IsEnum, IsArray, IsBoolean,
  ArrayMinSize, ArrayMaxSize, MinLength, IsEmail, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactType, ContactSource } from '@bitcrm/types';
import { ContactAddressDto } from './address.dto';

export class CreateContactDto {
  @ApiPropertyOptional({
    description:
      'Take any of these numbers off the contact that currently holds them. ' +
      'For when a number has genuinely changed hands and the caller is a new ' +
      'person — without it, a clash is rejected.',
  })
  @IsOptional()
  @IsBoolean()
  reassignPhones?: boolean;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiProperty({ example: ['(404) 555-1234'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  phones!: string[];

  @ApiPropertyOptional({ example: ['john@example.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @ApiPropertyOptional({ type: [ContactAddressDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactAddressDto)
  addresses?: ContactAddressDto[];

  @ApiPropertyOptional({ example: 'company-uuid' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ enum: ContactType, example: ContactType.RESIDENTIAL })
  @IsEnum(ContactType)
  type!: ContactType;

  @ApiPropertyOptional({ example: 'Manager' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ enum: ContactSource, example: ContactSource.MANUAL })
  @IsEnum(ContactSource)
  source!: ContactSource;

  @ApiPropertyOptional({ example: 'VIP customer' })
  @IsOptional()
  @IsString()
  notes?: string;
}
