import { Injectable, Logger } from '@nestjs/common';
import type { DocumentEmailAttachments } from '@bitcrm/types';
import { DocumentsService, type DocumentSource } from '../documents/documents.service';
import { EstimateSettingsService } from '../documents/estimate-settings.service';
import { MessagingClient } from '../integrations/messaging.client';

/** Workiz names the download `Estimate-<number>.pdf` / `Invoice-<number>.pdf`; the attachment is the same file. */
export function attachmentFileName(source: Pick<DocumentSource, 'kind' | 'doc'>): string {
  const kind = source.kind === 'invoice' ? 'Invoice' : 'Estimate';
  return `${kind}-${source.doc.number}.pdf`;
}

/**
 * Workiz "Attach PDF files" (Settings → Estimates): what the Send panel adds
 * to an email's `attachments[]` — the document's PDF, made here and uploaded
 * through messaging's presign on the caller's bearer, so the message the
 * panel then sends carries it as a MIME part beside the portal link.
 *
 * Best effort by design: with the switch off there is nothing to attach, and
 * when the file cannot be made (no browser on the box, an upload refused)
 * the email must still go out — the answer carries a `warning` the office
 * sees instead of a failure.
 */
@Injectable()
export class DocumentEmailAttachmentsService {
  private readonly logger = new Logger(DocumentEmailAttachmentsService.name);

  constructor(
    private readonly settings: EstimateSettingsService,
    private readonly documents: DocumentsService,
    private readonly messaging: MessagingClient,
  ) {}

  async forEmail(source: DocumentSource, authorization: string): Promise<DocumentEmailAttachments> {
    const { attachPdf } = await this.settings.get();
    if (!attachPdf) return { attachments: [] };
    const fileName = attachmentFileName(source);
    try {
      const bytes = await this.documents.pdfBuffer(source);
      const attachment = await this.messaging.uploadAttachment({ fileName, contentType: 'application/pdf', bytes }, authorization);
      return { attachments: [attachment] };
    } catch (err) {
      const why = (err as Error).message;
      this.logger.warn(`${fileName} not attached to the ${source.kind} email: ${why}`);
      return { attachments: [], warning: `The PDF could not be made (${why}) — the email goes out with the portal link only.` };
    }
  }
}
