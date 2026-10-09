import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentEmailAttachmentsService } from 'src/document-send/document-email-attachments.service';

/**
 * Workiz "Attach PDF files" (Settings → Estimates): the Send panel's email
 * carries the document's PDF beside the portal link. Billing makes the file
 * and uploads it through messaging's own presign on the caller's bearer; the
 * panel passes the handle in `attachments[]`. With the switch off there is
 * nothing to attach; when the file cannot be made the email still goes out —
 * with a warning the office sees.
 */
describe('DocumentEmailAttachmentsService', () => {
  const source = { kind: 'estimate' as const, doc: { id: 'e1', number: '1142' } as never, view: undefined };
  const attachment = { id: 'att-1', fileName: 'Estimate-1142.pdf', contentType: 'application/pdf' as const, size: 4 };

  function build(over: { attachPdf?: boolean; render?: () => Promise<Buffer>; upload?: () => Promise<typeof attachment> } = {}) {
    const settings = { get: jest.fn(async () => ({ attachPdf: over.attachPdf ?? true, autoDeclineSameJob: true })) };
    const documents = { pdfBuffer: jest.fn(over.render ?? (async () => Buffer.from('%PDF'))) };
    const messaging = { uploadAttachment: jest.fn(over.upload ?? (async () => attachment)) };
    const service = new DocumentEmailAttachmentsService(settings as never, documents as never, messaging as never);
    return { service, settings, documents, messaging };
  }

  it('renders the PDF and uploads it through messaging on the caller’s bearer, named after the document', async () => {
    const { service, documents, messaging } = build();
    const out = await service.forEmail(source, 'Bearer abc');
    expect(documents.pdfBuffer).toHaveBeenCalledWith(source);
    expect(messaging.uploadAttachment).toHaveBeenCalledWith(
      { fileName: 'Estimate-1142.pdf', contentType: 'application/pdf', bytes: Buffer.from('%PDF') },
      'Bearer abc',
    );
    expect(out).toEqual({ attachments: [attachment] });
  });

  it('names an invoice’s file Invoice-<number>.pdf', async () => {
    const { service, messaging } = build();
    await service.forEmail({ kind: 'invoice', doc: { id: 'deal-1', number: 'K4T9ZW' } as never, view: undefined }, 'Bearer abc');
    expect(messaging.uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Invoice-K4T9ZW.pdf' }), 'Bearer abc');
  });

  it('attaches nothing when the switch is off — and never renders', async () => {
    const { service, documents, messaging } = build({ attachPdf: false });
    await expect(service.forEmail(source, 'Bearer abc')).resolves.toEqual({ attachments: [] });
    expect(documents.pdfBuffer).not.toHaveBeenCalled();
    expect(messaging.uploadAttachment).not.toHaveBeenCalled();
  });

  it('when the PDF cannot be made (no browser) the email still goes out, with a warning', async () => {
    const { service } = build({
      render: async () => {
        throw new ServiceUnavailableException('PDF rendering unavailable: no Chrome/Chromium found');
      },
    });
    await expect(service.forEmail(source, 'Bearer abc')).resolves.toEqual({
      attachments: [],
      warning: 'The PDF could not be made (PDF rendering unavailable: no Chrome/Chromium found) — the email goes out with the portal link only.',
    });
  });

  it('when the upload is refused the email still goes out, with a warning', async () => {
    const { service } = build({
      upload: async () => {
        throw new Error('Attachment upload failed (403)');
      },
    });
    const out = await service.forEmail(source, 'Bearer abc');
    expect(out.attachments).toEqual([]);
    expect(out.warning).toMatch(/could not be made \(Attachment upload failed \(403\)\)/);
  });
});
