import { Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicesService } from '../invoices/invoices.service';
import { DocumentEmailAttachmentsService } from './document-email-attachments.service';

const DESCRIPTION =
  'Workiz "Attach PDF files" (Settings → Estimates). The Send panel calls this before emailing: with the switch on, ' +
  'the document’s PDF is rendered and uploaded through messaging’s presign ON THE CALLER’S BEARER (so `messages.send` ' +
  'is theirs), and the answer is what goes into `attachments[]` of `POST /api/messaging/messages`; with it off, ' +
  '`attachments` is empty. When the file cannot be made the answer is empty with a `warning` — the email still goes out.';

/**
 * `POST /estimates/:id/email-attachments`, `POST /invoices/:id/email-attachments`
 * — its own module so it can reach both document services without a cycle
 * (EstimatesModule / InvoicesModule import DocumentsModule).
 */
@ApiTags('Documents')
@ApiBearerAuth()
@Controller()
export class DocumentSendController {
  constructor(
    private readonly attachments: DocumentEmailAttachmentsService,
    private readonly estimates: EstimatesService,
    private readonly invoices: InvoicesService,
  ) {}

  @Post('estimates/:id/email-attachments')
  @RequirePermission('estimates', 'send')
  @ApiOperation({ summary: 'The PDF to attach to this estimate’s email, if the account attaches PDFs', description: `**Guard:** \`estimates.send\`. ${DESCRIPTION}` })
  async estimate(@Param('id') id: string, @CallerCtx() caller: Caller, @Headers('authorization') authorization?: string) {
    const source = await this.estimates.renderSource(id, caller);
    return { success: true, data: await this.attachments.forEmail(source, bearer(authorization)) };
  }

  @Post('invoices/:id/email-attachments')
  @RequirePermission('invoices', 'send')
  @ApiOperation({ summary: 'The PDF to attach to this invoice’s email, if the account attaches PDFs', description: `**Guard:** \`invoices.send\`. ${DESCRIPTION}` })
  async invoice(@Param('id') id: string, @CallerCtx() caller: Caller, @Headers('authorization') authorization?: string) {
    const source = await this.invoices.renderSource(id, caller);
    return { success: true, data: await this.attachments.forEmail(source, bearer(authorization)) };
  }
}

/** The guard admitted the caller, so the header is there; messaging needs it verbatim. */
function bearer(authorization?: string): string {
  if (!authorization) throw new UnauthorizedException('No bearer to upload the attachment with');
  return authorization;
}
