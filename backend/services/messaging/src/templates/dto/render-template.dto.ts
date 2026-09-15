import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { RenderContext } from '../render-context';

/** Design §7.1 `POST /templates/:id/render` — ids the loader turns into a context. */
export class RenderTemplateDto {
  @ApiPropertyOptional({ description: 'Party and last job come from the conversation.' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  dealId?: string;

  @ApiPropertyOptional({
    description: 'Explicit values that win over everything, e.g. `{ "late_value": "15" }`.',
    example: { late_value: '15' },
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, string>;
}

/**
 * `POST /templates/:id/preview` and `POST /templates/preview` — the render
 * inputs plus what an editor needs: an unsaved body, an inline sample
 * context, output format and whether to keep unresolved codes visible.
 */
export class PreviewTemplateDto extends RenderTemplateDto {
  @ApiPropertyOptional({ description: 'Unsaved body to preview instead of the stored one (HTML or text).', maxLength: 10000 })
  @IsOptional()
  @IsString()
  @Length(1, 10000)
  body?: string;

  @ApiPropertyOptional({ maxLength: 250 })
  @IsOptional()
  @IsString()
  @Length(0, 250)
  subject?: string;

  @ApiPropertyOptional({
    description:
      'Inline sample context, merged over whatever the ids load: ' +
      '`{ contact, deal, technician, company, customFields, settings, timezone }`.',
  })
  @IsOptional()
  @IsObject()
  context?: Partial<RenderContext>;

  @ApiPropertyOptional({ enum: ['text', 'html'], description: 'Defaults to text (html for email templates).' })
  @IsOptional()
  @IsIn(['text', 'html'])
  format?: 'text' | 'html';

  @ApiPropertyOptional({ description: 'Leave `{{code}}` visible for codes that did not resolve.', default: true })
  @IsOptional()
  @IsBoolean()
  keepMissing?: boolean;
}
