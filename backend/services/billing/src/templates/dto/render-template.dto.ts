import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { DOCUMENT_TEMPLATE_KINDS, type DocumentTemplateKind } from '@bitcrm/types';
import { TemplateContentDto } from './update-template.dto';

export class RenderSourceDto {
  @ApiProperty({ enum: ['invoice', 'estimate'] })
  @IsIn(['invoice', 'estimate'])
  kind!: 'invoice' | 'estimate';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class RenderTemplateDto {
  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KINDS })
  @IsIn(DOCUMENT_TEMPLATE_KINDS as unknown as string[])
  kind!: DocumentTemplateKind;

  @ApiProperty({ type: TemplateContentDto })
  @ValidateNested()
  @Type(() => TemplateContentDto)
  content!: TemplateContentDto;

  @ApiPropertyOptional({ type: RenderSourceDto, description: 'Render against a real document; sample data otherwise.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RenderSourceDto)
  source?: RenderSourceDto;

  @ApiProperty({ enum: ['html', 'pdf'] })
  @IsIn(['html', 'pdf'])
  format!: 'html' | 'pdf';
}
