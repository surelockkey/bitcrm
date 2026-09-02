import {
  IsString, IsOptional, IsEnum, IsArray, IsObject,
  ArrayMinSize, ArrayMaxSize, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContactType } from '@bitcrm/types';
import { ContactAddressDto } from './address.dto';

export class UpdateContactDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @ApiPropertyOptional({ example: ['(404) 555-1234'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  phones?: string[];

  @ApiPropertyOptional({
    example: { '+14045551234': '102' },
    description:
      'What to press once the call is answered, keyed by the number it ' +
      'belongs to. Keys are re-normalized server-side and entries for ' +
      'numbers not on the record are dropped.',
  })
  @IsOptional()
  @IsObject()
  phoneExtensions?: Record<string, string>;

  @ApiPropertyOptional({ example: ['jane@example.com'] })
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

  @ApiPropertyOptional({ enum: ContactType })
  @IsOptional()
  @IsEnum(ContactType)
  type?: ContactType;

  @ApiPropertyOptional({ example: 'Director' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
