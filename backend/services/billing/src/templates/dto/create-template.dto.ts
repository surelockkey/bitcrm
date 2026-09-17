import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOCUMENT_TEMPLATE_KINDS, type DocumentTemplateKind } from '@bitcrm/types';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Modern invoice', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KINDS })
  @IsIn(DOCUMENT_TEMPLATE_KINDS as unknown as string[])
  kind!: DocumentTemplateKind;

  @ApiPropertyOptional({ enum: ['classic', 'modern', 'minimal'] })
  @IsOptional()
  @IsString()
  presetId?: string;

  @ApiPropertyOptional({ description: 'Copy the content of this template instead of a preset.' })
  @IsOptional()
  @IsString()
  fromTemplateId?: string;
}
