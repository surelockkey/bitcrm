import {
  IsString, IsOptional, IsBoolean, IsInt, IsArray, IsIn, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from '@bitcrm/types';

/**
 * Hand-written rather than PartialType(CreateCustomFieldDto) to match the
 * job-type DTO style, where Swagger documents each field's update rule.
 */
export class UpdateCustomFieldDto {
  @ApiPropertyOptional({ example: 'Gate Code' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 'text', enum: CUSTOM_FIELD_TYPES })
  @IsOptional()
  @IsIn(CUSTOM_FIELD_TYPES)
  type?: CustomFieldType;

  @ApiPropertyOptional({ example: 'Access' })
  @IsOptional()
  @IsString()
  group?: string;

  @ApiPropertyOptional({ example: ['Kwikset', 'Schlage'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ example: [] })
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

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Set false to archive: the field leaves every form but still resolves on old deals.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
