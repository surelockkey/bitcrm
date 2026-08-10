import {
  IsString, IsOptional, IsBoolean, IsInt, IsArray, IsIn, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from '@bitcrm/types';

export class CreateCustomFieldDto {
  @ApiProperty({ example: 'Gate Code' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'text', enum: CUSTOM_FIELD_TYPES })
  @IsIn(CUSTOM_FIELD_TYPES)
  type!: CustomFieldType;

  @ApiPropertyOptional({ example: 'Access', description: 'Free-text heading; defaults to "".' })
  @IsOptional()
  @IsString()
  group?: string;

  @ApiPropertyOptional({
    example: ['Kwikset', 'Schlage'],
    description: 'Required for dropdown / multi_select; rejected for other types.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ example: [], description: 'Job-type ids this field applies to; [] means all.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jobTypeIds?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requiredToClose?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  searchable?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Higher sorts first within its group.' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
