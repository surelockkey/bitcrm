import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  DocumentPageSettings,
  DocumentRow,
  DocumentVisibility,
} from '@bitcrm/types';

export class AutoApplyDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jobTypeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreaIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Company (business profile) ids.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  businessProfileIds?: string[];
}

/**
 * The block tree itself is checked by `validateTemplateContent`
 * (@bitcrm/document-renderer), not by class-validator — nested plain objects
 * pass through the whitelist untouched.
 */
export class TemplateContentDto {
  @ApiProperty({ type: Object })
  @IsObject()
  page!: DocumentPageSettings;

  @ApiProperty({ type: [Object] })
  @IsArray()
  header!: DocumentRow[];

  @ApiProperty({ type: [Object] })
  @IsArray()
  body!: DocumentRow[];

  @ApiProperty({ type: [Object] })
  @IsArray()
  footer!: DocumentRow[];

  @ApiProperty({ type: Object })
  @IsObject()
  visibility!: DocumentVisibility;
}

export class UpdateTemplateDto extends TemplateContentDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: AutoApplyDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoApplyDto)
  autoApply?: AutoApplyDto | null;

  @ApiProperty({ example: 3, description: 'The version you loaded; a mismatch is a 409.' })
  @IsInt()
  @Min(0)
  version!: number;
}
