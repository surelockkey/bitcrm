import {
  IsString, IsOptional, IsEnum, IsArray,
  ArrayMinSize, ArrayMaxSize, MinLength, IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactType, ContactSource } from '@bitcrm/types';

export class CreateContactDto {
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
