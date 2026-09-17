import { Injectable } from '@nestjs/common';
import { S3Service } from '@bitcrm/shared';
import type {
  DocumentRenderContext,
  DocumentTemplate,
  DocumentTemplateContent,
  DocumentTemplateKind,
} from '@bitcrm/types';
import { pdfS3Key } from '../common/constants/dynamo.constants';
import { documentsKmsKeyId } from '../common/constants/services.constants';
import type { DealBillingView } from '../integrations/deal.client';
import { TemplatesService } from '../templates/templates.service';
import {
  DocumentContextBuilder,
  type BillingDocument,
  type BillingDocumentKind,
} from './document-context.builder';
import { pdfCacheHash } from './pdf-cache';
import { PdfService } from './pdf.service';
import { renderDocumentHtml } from './renderer';

export interface DocumentSource {
  kind: BillingDocumentKind;
  doc: BillingDocument;
  view: DealBillingView;
}

const URL_TTL_SECONDS = 300;

/** Presigned-URL `Content-Disposition`; quotes and non-ASCII are dropped from the name. */
export function contentDisposition(filename: string, download: boolean): string {
  const safe = filename.replace(/[^\w.\- ]+/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${safe}"`;
}

/**
 * Template resolution + rendering for billing documents. PDFs are
 * content-addressed in S3 (`billing/pdfs/<docId>/<hash>.pdf`): an unchanged
 * document is served from S3 without a browser.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly templates: TemplatesService,
    private readonly contexts: DocumentContextBuilder,
    private readonly pdfs: PdfService,
    private readonly s3: S3Service,
  ) {}

  async prepare(source: DocumentSource): Promise<{ template: DocumentTemplate; ctx: DocumentRenderContext }> {
    const template = await this.templates.resolveForDocument({
      kind: source.kind,
      templateId: source.doc.templateId,
      jobTypeId: source.view.deal.jobTypeId,
      serviceAreaId: source.view.deal.serviceAreaId,
      businessProfileId: source.view.deal.businessProfileId,
    });
    const ctx = await this.contexts.build(source.kind, source.doc, source.view, template);
    return { template, ctx };
  }

  /** Render context of a real document with a given (unsaved) template body. */
  buildContext(source: DocumentSource, content: DocumentTemplateContent): Promise<DocumentRenderContext> {
    return this.contexts.build(source.kind, source.doc, source.view, content);
  }

  async html(source: DocumentSource): Promise<{ html: string }> {
    const { template, ctx } = await this.prepare(source);
    return { html: renderDocumentHtml(template, ctx, { mode: 'screen' }) };
  }

  async pdf(source: DocumentSource, opts: { download: boolean; filename: string }): Promise<{ url: string }> {
    const { template, ctx } = await this.prepare(source);
    const key = pdfS3Key(source.doc.id, pdfCacheHash(template, ctx));
    if (!(await this.s3.objectExists(key))) {
      const html = renderDocumentHtml(template, ctx, { mode: 'pdf' });
      const buffer = await this.pdfs.render(html, source.kind);
      await this.s3.putObject(key, buffer, { contentType: 'application/pdf', kmsKeyId: documentsKmsKeyId() });
    }
    const url = await this.s3.getPresignedDownloadUrl(key, {
      expiresIn: URL_TTL_SECONDS,
      contentDisposition: contentDisposition(opts.filename, opts.download),
    });
    return { url };
  }

  /**
   * The editor's live preview: arbitrary content against a context. PDFs of
   * unsaved content are rendered fresh and stored under a `preview` prefix.
   */
  async renderContent(
    kind: DocumentTemplateKind,
    content: DocumentTemplateContent,
    ctx: DocumentRenderContext,
    format: 'html' | 'pdf',
  ): Promise<{ html: string } | { url: string }> {
    if (format === 'html') return { html: renderDocumentHtml(content, ctx, { mode: 'screen' }) };
    const hash = pdfCacheHash({ id: 'preview', version: 0 }, { ...ctx, content } as unknown as DocumentRenderContext);
    const key = pdfS3Key('preview', hash);
    if (!(await this.s3.objectExists(key))) {
      const buffer = await this.pdfs.render(renderDocumentHtml(content, ctx, { mode: 'pdf' }), kind);
      await this.s3.putObject(key, buffer, { contentType: 'application/pdf', kmsKeyId: documentsKmsKeyId() });
    }
    return {
      url: await this.s3.getPresignedDownloadUrl(key, {
        expiresIn: URL_TTL_SECONDS,
        contentDisposition: contentDisposition('preview.pdf', false),
      }),
    };
  }
}
