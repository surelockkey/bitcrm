import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { DocumentRenderContext } from '@bitcrm/types';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { DocumentsService } from '../documents/documents.service';
import { sampleRenderContext, validateTemplateContent } from '../documents/renderer';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicesService } from '../invoices/invoices.service';
import { pickContent } from './templates.service';
import { RenderTemplateDto } from './dto/render-template.dto';

/**
 * `POST /templates/render` — the editor's live preview. Lives apart from
 * TemplatesController because it needs the invoice/estimate services (which
 * themselves depend on templates).
 */
@ApiTags('Document templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplateRenderController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly invoices: InvoicesService,
    private readonly estimates: EstimatesService,
  ) {}

  @Post('render')
  @RequirePermission('document_templates', 'view')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Render unsaved template content',
    description:
      '**Guard:** `document_templates.view` (+ `invoices.view` / `estimates.view` scope when `source` is set). ' +
      'Sample data without `source`. `format: html` → `{html}`, `pdf` → `{url}`.',
  })
  async render(@Body() dto: RenderTemplateDto, @CallerCtx() caller: Caller) {
    const checked = validateTemplateContent(pickContent(dto.content));
    if (!checked.ok) throw new BadRequestException({ message: 'Invalid template content', errors: checked.errors });

    let ctx: DocumentRenderContext;
    if (dto.source) {
      const source =
        dto.source.kind === 'invoice'
          ? await this.invoices.renderSource(dto.source.id, caller)
          : await this.estimates.renderSource(dto.source.id, caller);
      ctx = await this.documents.buildContext(source, checked.value);
    } else {
      ctx = sampleRenderContext(dto.kind);
    }
    return { success: true, data: await this.documents.renderContent(dto.kind, checked.value, ctx, dto.format) };
  }
}
